/**
 * Flat sub-agent registry.
 *
 * Manages all sub-agents and their conversations as a single flat store.
 * Each sub-agent has N conversations; one is active at any time.
 *
 * Integrates with ToolSets by calling their session lifecycle hooks once
 * per agent (keyed by "${sessionId}:${agentName}") rather than
 * per-conversation — giving each agent its own isolated state shared
 * across all of its conversations.
 */

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
  RegistryDeps,
} from './registryInternal';
import {
  collectToolSetState,
  collectToolSetSymbolState,
  collectToolSetSnapshot,
  snapshotEntry,
} from './registrySnapshot';
import { createLifecycleFunctions } from './registryLifecycle';
import { createExecutionFunctions } from './registryExecution';
import type { SendMessageOpts } from './registryExecution';

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

  const deps: RegistryDeps = { subCtx, resolveToolSets, resolveTools, handler };

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

  // Holder for execution.sendMessage — wired below after execution is created.
  // This avoids a circular dependency between lifecycle (which needs
  // sendMessage for onSessionReady) and execution (which lifecycle creates).
  const sendMessageRef: {
    current?: (agentName: string, convId: string, text: string, opts: import('./registryExecution').SendMessageOpts) => Promise<import('./types').SubAgentResult>
  } = {};

  const lifecycle = createLifecycleFunctions(
    deps, collectToolSetState, collectToolSetSymbolState, convSubCleanups, notify,
    () => sessionId,
    sendMessageRef,
  );
  const execution = createExecutionFunctions(deps, entries);

  // Wire the holder now that execution is built — onSessionReady closures
  // created later by lifecycle.initAgentToolSets will pick up this reference.
  sendMessageRef.current = (agentName, convId, text, opts) =>
    execution.sendMessage(agentName, convId, text, opts);

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    get label(): string { return registryLabel; },
    getState(): SubAgentRegistryState {
      if (!registrySnapshotCache) {
        registrySnapshotCache = {
          subAgents: [...entries.values()].map((e) => snapshotEntry(deps, e)),
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
      const firstConv = lifecycle.createConversationForEntry('Conversation 1', entry);
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

      const title = options?.title ?? `Conversation ${entry.conversations.size + 1}`;
      const conv = lifecycle.createConversationForEntry(title, entry);
      entry.conversations.set(conv._state.id, conv);
      entry.activeConversationId = conv._state.id;
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
      // Only clear message history and progress — agent-level ToolSet state
      // is scoped to the agent, not the conversation, and must
      // not be reset when a single conversation is cleared.
      conv._state.tracker.reset();
      conv._state.streamingText = '';
      // Let per-conversation ToolSets reset their own state.
      const convCtx = subCtx(subAgentName, conversationId);
      for (const ts of resolveToolSets()) ts.onResetConversation?.(convCtx);
      // Invalidate the prompt-section cache so the next turn gets fresh content.
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
          ...collectToolSetSnapshot(deps, subCtx(e.name, c._state.id)),
        })),
        ...collectToolSetSnapshot(deps, subCtx(e.name, e.activeConversationId)),
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
        lifecycle.initAgentToolSets(sessionId, entry, raw as Record<string, unknown>);

        // Restore conversations after onInitSession — onInitConversation may
        // read state that onInitSession just set up.
        for (const sc of raw.conversations) {
          const conv = lifecycle.createConversationForEntry(sc.title, entry, sc.id);
          conv._state.tracker.replaceBoth(
            [...(sc.liveHistory ?? sc.history)],
            [...sc.history],
          );
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
