/**
 * Sub-agent lifecycle management.
 *
 * Handles ToolSet lifecycle hooks (onInit, onReady, onReset, onRemove) and
 * the creation / removal of conversations within a sub-agent entry.
 *
 * All ToolSet iteration is delegated to a {@link ToolSetScope} — no more
 * manual for-loops over `resolveToolSets()`.
 */

import type { ToolSetScope } from '@agent-sdk/tools/toolSetScope';
import type { ToolSetContext } from '@agent-type';
import { generateConvId, makeConversation } from './registryConversation';
import type { ConversationHandle } from './registryConversation';
import type { InternalEntry } from './registryInternal';
import type { collectToolSetState, collectToolSetSymbolState } from './registrySnapshot';
import type { SendMessageOpts } from './registryExecution';
import type { SubAgentResult } from './types';

type CollectToolSetStateFn = typeof collectToolSetState;
type CollectToolSetSymbolStateFn = typeof collectToolSetSymbolState;

export type LifecycleFunctions = {
  createConversationForEntry(
    title: string,
    entry: InternalEntry,
    existingId?: string,
  ): ConversationHandle;

  removeConversation(
    entry: InternalEntry,
    convId: string,
  ): void;

  initAgentToolSets(
    sessionId: string,
    entry: InternalEntry,
    entryData?: Record<string, unknown>,
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
 */
export function createLifecycleFunctions(
  subCtx: (agentName: string, conversationId: string) => ToolSetContext,
  resolveTools: (toolNames: readonly string[]) => import('@agent-type').Tool[],
  scope: ToolSetScope,
  collectState: CollectToolSetStateFn,
  collectSymbolState: CollectToolSetSymbolStateFn,
  convSubCleanups: Map<string, () => void>,
  notify: () => void,
  getSessionId: () => string,
  sendMessageRef: { current?: (agentName: string, convId: string, text: string, opts: SendMessageOpts) => Promise<SubAgentResult> },
  injectToolResultRef: { current?: (agentName: string, convId: string, toolCallId: string, name: string, result: unknown) => Promise<SubAgentResult> },
  convControllers: Map<string, AbortController>,
): LifecycleFunctions {
  // ── Conversation creation ─────────────────────────────────────────────────

  function subscribeConv(convCtx: ToolSetContext, conv: ConversationHandle): () => void {
    const unsub = scope.subscribeScope(convCtx, () => { conv._notify(); notify(); });
    return unsub;
  }

  function createConversationForEntry(
    title: string,
    entry: InternalEntry,
    existingId?: string,
  ): ConversationHandle {
    const id = existingId ?? generateConvId();
    const convCtx = subCtx(entry.name, id);
    const conv = makeConversation(id, getSessionId(), title, entry.name, notify, () => ({
      ...collectState(resolveTools, entry.toolNames, scope, convCtx),
      ...collectSymbolState(resolveTools, entry.toolNames, scope, convCtx),
    }));

    const unsub = subscribeConv(convCtx, conv);
    convSubCleanups.set(id, unsub);
    // Fire onInit so per-conversation ToolSet state is ready before the first turn.
    scope.initScope(convCtx);
    // Fire onReady per conversation so ToolSets (e.g. PendingInputToolSet)
    // receive the correct sendMessage for this specific conversation.
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
        void fn(entry.name, id, toolCallId, name, result).finally(() => convControllers.delete(resumeAbortKey));
      },
    });
    return conv;
  }

  // ── Conversation removal ──────────────────────────────────────────────────

  function removeConversation(entry: InternalEntry, convId: string): void {
    const conv = entry.conversations.get(convId);
    if (!conv) return;
    // Fire onRemove before tearing down subscriptions so ToolSets
    // can access their own state one last time during cleanup.
    const convCtx = subCtx(entry.name, convId);
    scope.removeScope(convCtx);
    convSubCleanups.get(convId)?.();
    convSubCleanups.delete(convId);
    entry.conversations.delete(convId);
    // Pick new active if needed.
    if (entry.activeConversationId === convId) {
      const remaining = [...entry.conversations.keys()];
      if (remaining.length > 0) {
        entry.activeConversationId = remaining[remaining.length - 1];
      } else {
        // Always keep at least one conversation.
        const fallback = createConversationForEntry('Conversation 1', entry);
        entry.conversations.set(fallback._state.id, fallback);
        entry.activeConversationId = fallback._state.id;
      }
    }
  }

  // ── Agent-level ToolSet initialisation ────────────────────────────────────

  function initAgentToolSets(
    sessionId: string,
    entry: InternalEntry,
    entryData: Record<string, unknown> = {},
  ): void {
    const ctx = subCtx(entry.name, entry.activeConversationId);
    const initData = { id: sessionId, title: entry.name, ...entryData } as import('../../client/sessionManager.types').SessionEntryData;
    scope.initScope(ctx, initData);
  }

  // ── Agent-level ToolSet teardown ──────────────────────────────────────────

  function removeAgentToolSets(entry: InternalEntry): void {
    // Fire onRemove for every conversation so per-conversation
    // ToolSet state is properly released.
    for (const [convId] of entry.conversations) {
      const convCtx = subCtx(entry.name, convId);
      scope.removeScope(convCtx);
      convSubCleanups.get(convId)?.();
      convSubCleanups.delete(convId);
    }
    const ctx = subCtx(entry.name, entry.activeConversationId);
    scope.removeScope(ctx);
  }

  // ── Return bound functions ────────────────────────────────────────────────

  return {
    createConversationForEntry,
    removeConversation,
    initAgentToolSets,
    removeAgentToolSets,
  };
}
