/**
 * Sub-agent lifecycle management.
 *
 * Handles ToolSet lifecycle hooks (onInitSession, onRemoveSession,
 * onInitConversation, onRemoveConversation) and the creation / removal of
 * conversations within a sub-agent entry.
 *
 * Exported as a factory to capture closure dependencies without repetitive
 * parameter passing.
 */

import type { SessionEntryData } from '../../client/sessionManager.types';
import { generateConvId, makeConversation } from './registryConversation';
import type { ConversationHandle } from './registryConversation';
import type { InternalEntry, RegistryDeps } from './registryInternal';
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
 * Create lifecycle management functions bound to a set of shared dependencies.
 *
 * @param deps             Registry-level deps (subCtx, resolveToolSets, etc.).
 * @param collectState     The `collectToolSetState` function from registrySnapshot.
 * @param convSubCleanups  Mutable map of per-conversation cleanup callbacks.
 * @param notify           Registry-level notify function (snapshot invalidation).
 * @param getSessionId     Returns the parent session ID (for onSessionReady).
 * @param sendMessageRef   Mutable holder for execution.sendMessage — wired
 *                         after `createExecutionFunctions` builds the execution
 *                         object (avoiding a circular dependency).
 */
export function createLifecycleFunctions(
  deps: RegistryDeps,
  collectState: CollectToolSetStateFn,
  collectSymbolState: CollectToolSetSymbolStateFn,
  convSubCleanups: Map<string, () => void>,
  notify: () => void,
  getSessionId: () => string,
  sendMessageRef: { current?: (agentName: string, convId: string, text: string, opts: SendMessageOpts) => Promise<SubAgentResult> },
  convControllers: Map<string, AbortController>,
): LifecycleFunctions {
  // ── Conversation creation ─────────────────────────────────────────────────

  function createConversationForEntry(
    title: string,
    entry: InternalEntry,
    existingId?: string,
  ): ConversationHandle {
    const id = existingId ?? generateConvId();
    const convCtx = deps.subCtx(entry.name, id);
    const conv = makeConversation(id, getSessionId(), title, entry.name, notify, () => ({
      ...collectState(deps, convCtx, entry),
      ...collectSymbolState(deps, convCtx, entry),
    }));

    const unsubs: Array<() => void> = [];
    for (const ts of deps.resolveToolSets()) {
      const u = ts.onSubscribe?.(convCtx, () => { conv._notify(); notify(); });
      if (u) unsubs.push(u);
    }
    if (unsubs.length > 0) {
      convSubCleanups.set(id, () => { for (const u of unsubs) u(); });
    }
    // Fire onInitConversation so per-conversation ToolSet state is ready before the first turn.
    for (const ts of deps.resolveToolSets()) {
      ts.onInitConversation?.(convCtx);
    }
    // Fire onSessionReady per conversation so ToolSets (e.g. PendingInputToolSet)
    // receive the correct sendMessage for this specific conversation.
    // Track the AbortController so UI-initiated cancel can abort auto-resumed sends.
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
    for (const ts of deps.resolveToolSets()) {
      ts.onSessionReady?.(convCtx, {
        sendMessage: subSendMessage,
        injectToolResult: (_toolCallId, _name, _result) => {
          // Sub-agent conversations don't support tool-result injection.
          // This is a no-op; the main-agent session handles bound-prompt
          // restoration.
        },
      });
    }
    return conv;
  }

  // ── Conversation removal ──────────────────────────────────────────────────

  function removeConversation(entry: InternalEntry, convId: string): void {
    const conv = entry.conversations.get(convId);
    if (!conv) return;
    // Fire onRemoveConversation before tearing down subscriptions so ToolSets
    // can access their own state one last time during cleanup.
    const convCtx = deps.subCtx(entry.name, convId);
    for (const ts of deps.resolveToolSets()) ts.onRemoveConversation?.(convCtx);
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

  /**
   * Fire ToolSet `onInitSession` hooks at the agent level.
   * Called when an agent entry is first created or restored from a snapshot.
   * Per-conversation subscriptions are managed by `createConversationForEntry`.
   *
   * Uses the active conversation ID so `ctxKey` produces the
   * correct per-agent key `"${sessionId}:${agentName}"` regardless of which
   * conversation happens to be active at call time.
   */
  function initAgentToolSets(
    sessionId: string,
    entry: InternalEntry,
    entryData: Record<string, unknown> = {},
  ): void {
    const ctx = deps.subCtx(entry.name, entry.activeConversationId);
    const initData = { id: sessionId, title: entry.name, ...entryData } as SessionEntryData;
    for (const ts of deps.resolveToolSets()) {
      ts.onInitSession?.(ctx, initData);
    }
  }

  // ── Agent-level ToolSet teardown ──────────────────────────────────────────

  /** Tear down all per-conversation subscriptions and ToolSet hooks for an agent. */
  function removeAgentToolSets(entry: InternalEntry): void {
    // Fire onRemoveConversation for every conversation so per-conversation
    // ToolSet state is properly released.
    for (const [convId] of entry.conversations) {
      const convCtx = deps.subCtx(entry.name, convId);
      for (const ts of deps.resolveToolSets()) ts.onRemoveConversation?.(convCtx);
      convSubCleanups.get(convId)?.();
      convSubCleanups.delete(convId);
    }
    const ctx = deps.subCtx(entry.name, entry.activeConversationId);
    for (const ts of deps.resolveToolSets()) ts.onRemoveSession?.(ctx);
  }

  // ── Return bound functions ────────────────────────────────────────────────

  return {
    createConversationForEntry,
    removeConversation,
    initAgentToolSets,
    removeAgentToolSets,
  };
}
