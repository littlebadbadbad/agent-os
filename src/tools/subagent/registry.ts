import type { ToolSetContext } from '@agent-type';
import type { AgentMessage, Tool } from '@agent-type';
import type {
  ConversationMessageEntry,
  SubAgentRegistry,
  SubAgentRegistryState,
  SubAgentSerializedEntry,
} from '@agent-sdk/tools/subagent/registryTypes';
import { createSystemPromptCache } from '@agent-sdk/tools/prompts/section';
import type {
  InternalEntry,
  CreateSubAgentRegistryOptions,
} from './registryInternal';
import {
  collectToolSetState,
  collectToolSetSymbolState,
  snapshotEntry,
} from './registrySnapshot';
import { createLifecycleFunctions } from './registryLifecycle';
import { createExecutionFunctions } from './registryExecution';
import type { SendMessageOpts } from './registryExecution';
import { extractAssistantOutput } from './registryExecution';
import type { SubAgentResult } from './types';
import { createToolSetScope } from '@agent-sdk/tools/toolSetScope';
import { agentMessagesToUI } from '@agent-sdk';

// ── Factory ───────────────────────────────────────────────────────────────────

export type { CreateSubAgentRegistryOptions };

export function createSubAgentRegistry(options: CreateSubAgentRegistryOptions): SubAgentRegistry {
  const { getToolSets, sessionId, toolPool, handler, label } = options;
  const registryLabel = label ?? 'Sub-Agents';

  // ── Closure state ──────────────────────────────────────────────────────────

  /** Per-conversation abort controllers for UI-initiated sends. */
  const convControllers = new Map<string, AbortController>();
  /** Per-conversation subscription cleanups. Populated by lifecycle factory. */
  const convSubCleanups = new Map<string, () => void>();

  const entries = new Map<string, InternalEntry>();
  const subscribers = new Set<() => void>();
  let registrySnapshotCache: SubAgentRegistryState | undefined;
  let notifying = false;

  // ── Deps from closure ─────────────────────────────────────────────────────

  const resolveToolSets = () => getToolSets?.() ?? [];

  function resolveTools(toolNames: readonly string[]): Tool[] {
    const pool = toolPool();
    return toolNames.map((n) => {
      const t = pool.get(n);
      if (!t) {
        throw new Error(
          `Unknown tool "${n}". Available: ${[...pool.keys()].join(', ')}`,
        );
      }
      return t;
    });
  }

  function subCtx(agentName: string, conversationId: string): ToolSetContext {
    return { sessionId, agentName, conversationId };
  }

  const scope = createToolSetScope(resolveToolSets, handler);

  // ── Notification ───────────────────────────────────────────────────────────

  function notify(): void {
    if (notifying) return;
    notifying = true;
    try {
      registrySnapshotCache = undefined;
      for (const fn of subscribers) fn();
    } finally {
      notifying = false;
    }
  }

  // ── Sub-module factories ───────────────────────────────────────────────────

  // Holders for execution.sendMessage / injectToolResult — wired below after
  // execution is created.  This avoids a circular dependency between lifecycle
  // (which needs these for onSessionReady) and execution (which lifecycle creates).
  const sendMessageRef: {
    current?: (agentName: string, convId: string, text: string, opts: SendMessageOpts) => Promise<SubAgentResult>
  } = {};
  const injectToolResultRef: {
    current?: (agentName: string, convId: string, toolCallId: string, name: string, result: unknown) => Promise<SubAgentResult>
  } = {};

  const lifecycle = createLifecycleFunctions(
    subCtx, resolveTools, scope, collectToolSetState, collectToolSetSymbolState, convSubCleanups, notify,
    () => sessionId,
    sendMessageRef,
    injectToolResultRef,
    convControllers,
    handler,
  );
  const execution = createExecutionFunctions({ subCtx, resolveTools, handler, scope }, entries);

  // Wire the holders now that execution is built — onSessionReady closures
  // created later by lifecycle.initAgentToolSets will pick up these references.
  sendMessageRef.current = (agentName, convId, text, opts) =>
    execution.sendMessage(agentName, convId, text, opts);
  injectToolResultRef.current = (agentName, convId, toolCallId, name, result) => {
    const entry = entries.get(agentName);
    if (!entry) throw new Error(`Sub-agent "${agentName}" not found.`);
    const conv = entry.conversations.get(convId);
    if (!conv) throw new Error(`Conversation "${convId}" not found on sub-agent "${agentName}".`);
    // Guard: if the conversation is currently processing a turn, skip the
    // injection — the agent will process the answer when it reads the
    // restored ghost entry from the user-input store on the next turn.
    // This mirrors the ConversationRunner's own isLoading guard.
    if (conv._state.isLoading) {
      return Promise.resolve({
        output: '', turns: 0, toolCallCount: 0,
        history: conv._state.tracker.getLiveHistory(),
      } satisfies SubAgentResult);
    }
    // Delegate to the persistent runner — same as the main agent path.
    if (!conv._state.runner) {
      throw new Error(`Conversation "${convId}" has no runner.`);
    }
    return conv._state.runner.injectToolResult(toolCallId, name, result).then(() => {
      const history = conv._state.tracker.getLiveHistory();
      const output = extractAssistantOutput(history);
      conv._state.tracker.reconcile();
      return {
        output,
        turns: conv._state.runner!.lastRun?.turns ?? 0,
        toolCallCount: conv._state.runner!.lastRun?.toolCallCount ?? 0,
        history,
      } satisfies SubAgentResult;
    });
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    get label(): string { return registryLabel; },
    getState(): SubAgentRegistryState {
      if (!registrySnapshotCache) {
        registrySnapshotCache = {
          subAgents: [...entries.values()].map((e) => snapshotEntry(subCtx, resolveTools, scope, e)),
        };
      }
      return registrySnapshotCache;
    },

    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // ── Sub-agent CRUD ──────────────────────────────────────────────────────

    createSubAgent(params) {
      if (!params.name || /\s/.test(params.name)) {
        throw new Error('Sub-agent name must be a non-empty string with no whitespace.');
      }
      if (entries.has(params.name)) {
        throw new Error(`Sub-agent "${params.name}" already exists.`);
      }
      // Validate tool names before creating anything.
      resolveTools(params.toolNames);

      const entry: InternalEntry = {
        name:                 params.name,
        description:          params.description,
        systemPrompt:         params.systemPrompt,
        toolNames:            [...params.toolNames],
        maxTurns:             params.maxTurns,
        parent:               params.parent,
        createdAt:            new Date().toISOString(),
        activeConversationId: '',
        conversations:        new Map(),
        sectionCache:         createSystemPromptCache(),
      };

      // Wire agent-level ToolSet hooks FIRST (onInitSession) so that any
      // per-agent state they initialize is available when the first conversation
      // is created and onInitConversation fires.
      lifecycle.initAgentToolSets(sessionId, entry);

      // Create the initial conversation after onInitSession — onInitConversation
      // may read state that onInitSession just set up.
      const firstConv = lifecycle.createConversationForEntry('', entry);
      entry.conversations.set(firstConv._state.id, firstConv);
      entry.activeConversationId = firstConv._state.id;

      entries.set(params.name, entry);
      notify();
      return firstConv;
    },

    updateSubAgent(name, patch) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`Sub-agent "${name}" not found.`);

      if (patch.toolNames !== undefined) resolveTools(patch.toolNames);

      entry.description  = patch.description  ?? entry.description;
      entry.systemPrompt = 'systemPrompt' in patch ? patch.systemPrompt : entry.systemPrompt;
      entry.toolNames    = patch.toolNames !== undefined ? [...patch.toolNames] : entry.toolNames;
      entry.maxTurns     = patch.maxTurns     ?? entry.maxTurns;

      notify();
    },

    deleteSubAgent(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`Sub-agent "${name}" not found.`);

      lifecycle.removeAgentToolSets(entry);
      entries.delete(name);
      notify();
    },

    // ── Conversation CRUD ───────────────────────────────────────────────────

    createConversation(subAgentName, options) {
      const entry = entries.get(subAgentName);
      if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);

      const title = options?.title ?? '';    // '' means no custom title yet
      const conv = lifecycle.createConversationForEntry(title, entry);
      entry.conversations.set(conv._state.id, conv);
      // Only switch active when explicitly requested. Default keeps the
      // current active conversation so that send_*_message without an
      // explicit conversation_id continues targeting the same conversation.
      if (options?.setActive) {
        entry.activeConversationId = conv._state.id;
      }
      notify();
      return conv;
    },

    deleteConversation(subAgentName, conversationId) {
      const entry = entries.get(subAgentName);
      if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);
      if (!entry.conversations.has(conversationId)) {
        throw new Error(`Conversation "${conversationId}" not found on sub-agent "${subAgentName}".`);
      }
      lifecycle.removeConversation(entry, conversationId);
      notify();
    },

    setActiveConversation(subAgentName, conversationId) {
      const entry = entries.get(subAgentName);
      if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);
      if (!entry.conversations.has(conversationId)) {
        throw new Error(`Conversation "${conversationId}" not found on sub-agent "${subAgentName}".`);
      }
      entry.activeConversationId = conversationId;
      notify();
    },

    clearConversationHistory(subAgentName, conversationId) {
      const entry = entries.get(subAgentName);
      if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);
      const conv = entry.conversations.get(conversationId);
      if (!conv) {
        throw new Error(`Conversation "${conversationId}" not found on sub-agent "${subAgentName}".`);
      }
      conv._state.tracker.reset();
      conv._state.streamingText = '';
      conv._state.msgList.truncate(0);
      const convCtx = subCtx(subAgentName, conversationId);
      scope.resetScope(convCtx);
      entry.sectionCache.invalidate();
      conv._notifyRegistry();
    },

    // ── Execution ───────────────────────────────────────────────────────────

    sendMessage: execution.sendMessage,

    readHistory(subAgentName, conversationId, fromIndex = 0, maxMessages) {
      const entry = entries.get(subAgentName);
      if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);
      const conv = entry.conversations.get(conversationId);
      if (!conv) throw new Error(`Conversation "${conversationId}" not found on sub-agent "${subAgentName}".`);
      const history = conv._state.tracker.getLiveHistory();
      const slice = history.slice(
        fromIndex,
        maxMessages !== undefined ? fromIndex + maxMessages : undefined,
      );
      return slice.map((msg, i): ConversationMessageEntry => ({ ...msg, index: fromIndex + i }));
    },

    getConversation(subAgentName, conversationId) {
      const entry = entries.get(subAgentName);
      if (!entry) return undefined;
      return entry.conversations.get(conversationId);
    },

    // ── UI-initiated send / cancel ──────────────────────────────────────────

    async sendConversationMessage(agentName, conversationId, message, attachments) {
      const key = `${agentName}:${conversationId}`;
      // Do NOT pre-emptively abort the current run.
      // execution.sendMessage() runs onInterceptMessage first — if a
      // pending-input plugin is active the message will be queued and the
      // current run allowed to finish naturally so onAfterRun can resume().
      // Without an interceptor, sendMessage throws "already running" which
      // is the correct guard against concurrent sends on the same conversation.
      const controller = new AbortController();
      convControllers.set(key, controller);
      try {
        await execution.sendMessage(agentName, conversationId, message, {
          sessionId,
          signal: controller.signal,
          attachments,
        });
      } finally {
        if (convControllers.get(key) === controller) convControllers.delete(key);
      }
    },

    cancelConversationMessage(agentName, conversationId) {
      const key = `${agentName}:${conversationId}`;
      convControllers.get(key)?.abort();
      // Also abort any in-flight auto-resumed send for this conversation.
      convControllers.get(`resume:${agentName}:${conversationId}`)?.abort();
    },

    async editConversationMessage(agentName, conversationId, userCount, newText, attachments) {
      const key = `${agentName}:${conversationId}`;
      // Same rationale as sendConversationMessage: let the interceptor
      // decide whether to queue or proceed; don't pre-abort the current run.
      const controller = new AbortController();
      convControllers.set(key, controller);
      try {
        await execution.editConversationMessage(agentName, conversationId, userCount, newText, {
          sessionId,
          signal: controller.signal,
          attachments,
        });
      } finally {
        if (convControllers.get(key) === controller) convControllers.delete(key);
      }
    },

    // ── Persistence ───────────────────────────────────────────────────

    getSnapshot(): SubAgentSerializedEntry[] {
      return [...entries.values()].map((e) => ({
        name:                 e.name,
        description:          e.description,
        systemPrompt:         e.systemPrompt,
        toolNames:            [...e.toolNames],
        maxTurns:             e.maxTurns,
        parent:               e.parent,
        createdAt:            e.createdAt,
        activeConversationId: e.activeConversationId,
        conversations: [...e.conversations.values()].map((c) => ({
            id:          c._state.id,
            agentName:   c._state.agentName,
            title:       c._state.title,
            history:     c._state.tracker.getFullHistory(),
            liveHistory: c._state.tracker.getLiveHistory(),
            ...scope.collectSnapshot(subCtx(e.name, c._state.id)),
        })),
        ...scope.collectSnapshot(subCtx(e.name, '__entry__')),
      } as SubAgentSerializedEntry));
    },

    loadSnapshot(serialized: SubAgentSerializedEntry[]): void {
      // Tear down existing entries before replacing.
      for (const entry of entries.values()) lifecycle.removeAgentToolSets(entry);
      entries.clear();

      for (const raw of serialized) {
        const entry: InternalEntry = {
          name:                 raw.name,
          description:          raw.description,
          systemPrompt:         raw.systemPrompt,
          toolNames:            [...raw.toolNames],
          maxTurns:             raw.maxTurns,
          parent:               raw.parent,
          createdAt:            raw.createdAt,
          activeConversationId: '',
          conversations:        new Map(),
          sectionCache:         createSystemPromptCache(),
        };

        entry.activeConversationId = raw.activeConversationId;

        // Restore agent-level ToolSet hooks FIRST (onInitSession) so that
        // per-agent state is ready before any conversation's onInitConversation
        // fires.
        lifecycle.initAgentToolSets(sessionId, entry, raw);

        // Restore conversations after onInitSession — onInitConversation may
        // read state that onInitSession just set up.
        for (const sc of raw.conversations) {
          // Pass snapshot data to createConversationForEntry so onInit fires
          // BEFORE onReady — critical for ToolSets (e.g. user-input) that
          // wire restore logic (ghost → injectToolResult) inside onReady.
          const conv = lifecycle.createConversationForEntry(sc.title, entry, sc.id, { ...sc, id: sessionId });
          conv._state.tracker.replaceBoth(
            [...(sc.liveHistory ?? sc.history)],
            [...sc.history],
          );
          // Seal orphaned tool calls that may exist if a snapshot was saved
          // mid-turn before tool results arrived (e.g. page refresh during
          // tool execution). Synthetic "cancelled" results prevent API errors.
          conv._state.tracker.sealOrphanedToolCalls();
          // Populate msgList from restored history so the UI renders the
          // full conversation immediately (no blank state on reload).
          const restoredMsgs = agentMessagesToUI(sc.history);
          if (restoredMsgs.length > 0) conv._state.msgList.push(...restoredMsgs);
          entry.conversations.set(sc.id, conv);
        }

        // Finalize active conversation ID now that the map is populated.
        if (!entry.conversations.has(entry.activeConversationId)) {
          entry.activeConversationId = [...entry.conversations.keys()][0] || '';
        }

        entries.set(raw.name, entry);
      }

      notify();
    },
  };
}
