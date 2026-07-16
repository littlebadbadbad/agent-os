import type { ToolSetScope } from "@agent-sdk/tools/toolSetScope";
import type { ToolSetContext, SessionEntryData } from "@agent-type";
import type { AgentHandler, Tool } from "@agent-type";
import { generateConvId, makeConversation } from "./registryConversation";
import type { ConversationHandle } from "./registryConversation";
import type { InternalEntry } from "./registryInternal";
import type {
  collectToolSetState,
  collectToolSetSymbolState,
} from "./registrySnapshot";
import type { SendMessageOpts } from "./registryExecution";
import type { SubAgentResult } from "./types";
import {
  SubAgentSerializedConversation,
  SubAgentSerializedEntry,
} from "./registryTypes";
import { createConversationRunner } from "@agent-sdk/tools/conversationRunner";
import type { EngineRefs } from "@agent-sdk/tools/conversationEngine";
import { toDescriptors } from "../toDescriptor";
import { emptyRegistry, withTool } from "../registry";

type CollectToolSetStateFn = typeof collectToolSetState;
type CollectToolSetSymbolStateFn = typeof collectToolSetSymbolState;

export type LifecycleFunctions = {
  createConversationForEntry(
    title: string,
    entry: InternalEntry,
    existingId?: string,
    entryData?: SubAgentSerializedConversation,
  ): ConversationHandle;

  removeConversation(entry: InternalEntry, convId: string): void;

  initAgentToolSets(
    sessionId: string,
    entry: InternalEntry,
    entryData?: SubAgentSerializedEntry,
  ): void;

  removeAgentToolSets(entry: InternalEntry): void;
};

/**
 * Create lifecycle management functions bound to a toolset scope + subagent
 * dependency bag.
 *
 * @param subCtx           Build a ToolSetContext for a sub-agent conversation.
 * @param resolveTools     Resolve tool names to Tool instances.
 * @param scope            Unified ToolSet lifecycle orchestrator.
 * @param collectState     The `collectToolSetState` function from registrySnapshot.
 * @param convSubCleanups  Mutable map of per-conversation cleanup callbacks.
 * @param notify           Registry-level notify function (snapshot invalidation).
 * @param getSessionId     Returns the parent session ID (for onSessionReady).
 * @param sendMessageRef   Mutable holder for execution.sendMessage — wired
 *                         after `createExecutionFunctions` builds the execution
 *                         object (avoiding a circular dependency).
 * @param handler          The AgentHandler used to invoke the LLM — forwarded
 *                         to the persistent ConversationRunner's invokeHandler.
 */
export function createLifecycleFunctions(
  subCtx: (agentName: string, conversationId: string) => ToolSetContext,
  resolveTools: (toolNames: readonly string[]) => Tool[],
  scope: ToolSetScope,
  collectState: CollectToolSetStateFn,
  collectSymbolState: CollectToolSetSymbolStateFn,
  convSubCleanups: Map<string, () => void>,
  notify: () => void,
  getSessionId: () => string,
  sendMessageRef: {
    current?: (
      agentName: string,
      convId: string,
      text: string,
      opts: SendMessageOpts,
    ) => Promise<SubAgentResult>;
  },
  injectToolResultRef: {
    current?: (
      agentName: string,
      convId: string,
      toolCallId: string,
      name: string,
      result: unknown,
    ) => Promise<SubAgentResult>;
  },
  convControllers: Map<string, AbortController>,
  handler: AgentHandler,
): LifecycleFunctions {
  function subscribeConv(
    convCtx: ToolSetContext,
    conv: ConversationHandle,
  ): () => void {
    const unsub = scope.subscribeScope(convCtx, () => {
      conv._notify();
      notify();
    });
    return unsub;
  }

  function createConversationForEntry(
    title: string,
    entry: InternalEntry,
    existingId?: string,
    entryData?: SubAgentSerializedConversation,
  ): ConversationHandle {
    const id = existingId ?? generateConvId();
    const convCtx = subCtx(entry.name, id);
    const conv = makeConversation(
      id,
      getSessionId(),
      title,
      entry.name,
      notify,
      () => ({
        ...collectState(resolveTools, entry.toolNames, scope, convCtx),
        ...collectSymbolState(resolveTools, entry.toolNames, scope, convCtx),
      }),
    );
    const unsub = subscribeConv(convCtx, conv);
    convSubCleanups.set(id, unsub);
    scope.initScope(convCtx, entryData);

    // ── Build persistent ConversationRunner ───────────────────────────────
    // Created once per conversation lifetime, matching the main agent's
    // pattern.  Both `sendMessage` and `editAndSendMessage` delegate to this
    // runner, eliminating throwaway runners on every execution call.
    const tools = scope.filterTools(resolveTools(entry.toolNames), convCtx);
    const subRegistry = tools.reduce((r, t) => withTool(r, t), emptyRegistry());
    const pipeline = scope.createPipeline(convCtx, subRegistry);

    // Cache system prompt across turns — invalidated when user text changes
    // (e.g. edit-and-resend with different message).
    let cachedUserText = '';
    let cachedSystemPrompt: string | undefined = '';

    const refs: EngineRefs = { isLoading: false, abortController: null };

    const runner = createConversationRunner({
      msgList: conv._state.msgList,
      tracker: conv._state.tracker,
      refs,
      scope,
      tsCtx: convCtx,
      maxAgentTurns: entry.maxTurns,

      notify: (isLoading) => {
        conv._state.isLoading = isLoading;
        conv._notifyRegistry();
      },

      invokeHandler: (msgs, signal, userText) => {
        if (userText !== cachedUserText) {
          cachedUserText = userText;
          cachedSystemPrompt = scope.buildSystemPrompt(
            entry.systemPrompt, convCtx, userText, entry.sectionCache,
          );
        }
        return handler(msgs, {
          tools: toDescriptors(tools),
          callTool: (call) => pipeline(call, signal),
          toolChoice: 'auto',
          systemPrompt: cachedSystemPrompt,
          signal,
        });
      },

      runToolCall: (call) => pipeline(call, refs.abortController!.signal),

      onInterceptMessage: (text, attachments, isLoading) =>
        scope.interceptMessage(convCtx, text, attachments, isLoading),
    });

    conv._state.runner = runner;
    const sessionId = getSessionId();
    const resumeAbortKey = `resume:${entry.name}:${id}`;
    const subSendMessage = (text: string) => {
      const fn = sendMessageRef.current;
      if (!fn) return;
      const controller = new AbortController();
      convControllers.set(resumeAbortKey, controller);
      void fn(entry.name, id, text, {
        sessionId,
        signal: controller.signal,
      }).finally(() => convControllers.delete(resumeAbortKey));
    };
    scope.readyScope(convCtx, {
      sendMessage: subSendMessage,
      injectToolResult: (toolCallId, name, result) => {
        const fn = injectToolResultRef.current;
        if (!fn) return;
        const controller = new AbortController();
        convControllers.set(resumeAbortKey, controller);
        void fn(entry.name, id, toolCallId, name, result).finally(() =>
          convControllers.delete(resumeAbortKey),
        );
      },
    });
    return conv;
  }

  function removeConversation(entry: InternalEntry, convId: string): void {
    const conv = entry.conversations.get(convId);
    if (!conv) return;
    const convCtx = subCtx(entry.name, convId);
    scope.removeScope(convCtx);
    convSubCleanups.get(convId)?.();
    convSubCleanups.delete(convId);
    entry.conversations.delete(convId);
    if (entry.activeConversationId === convId) {
      const remaining = [...entry.conversations.keys()];
      if (remaining.length > 0) {
        entry.activeConversationId = remaining[remaining.length - 1];
      } else {
        const fallback = createConversationForEntry("Conversation 1", entry);
        entry.conversations.set(fallback._state.id, fallback);
        entry.activeConversationId = fallback._state.id;
      }
    }
  }

  function initAgentToolSets(
    sessionId: string,
    entry: InternalEntry,
    entryData: SubAgentSerializedEntry,
  ): void {
    const ctx = subCtx(entry.name, entry.activeConversationId);
    scope.initScope(ctx, {
      ...entryData,
      id: sessionId,
      title: entry.name,
    } as SessionEntryData);
  }

  function removeAgentToolSets(entry: InternalEntry): void {
    for (const [convId] of entry.conversations) {
      const convCtx = subCtx(entry.name, convId);
      scope.removeScope(convCtx);
      convSubCleanups.get(convId)?.();
      convSubCleanups.delete(convId);
    }
    const ctx = subCtx(entry.name, entry.activeConversationId);
    scope.removeScope(ctx);
  }

  return {
    createConversationForEntry,
    removeConversation,
    initAgentToolSets,
    removeAgentToolSets,
  };
}
