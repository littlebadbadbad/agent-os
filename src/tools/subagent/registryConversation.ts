/**
 * Sub-agent conversation state management.
 *
 * Extracted from `registry.ts` — provides the low-level conversation data
 * structure and reactive state wrapper used by the flat sub-agent registry.
 *
 * This module has no dependencies on the registry's internal closure state
 * and can be tested / reasoned about in isolation.
 */

import type { AgentMessage } from '@agent-type';
import { createHistoryTracker, type HistoryTracker } from '@agent-sdk/tools/historyTracker';
import type {
  SubAgentConversation,
  SubAgentConversationState,
} from './registryTypes';

// ── ID generation ─────────────────────────────────────────────────────────────

let convCounter = 0;

/** Generate a unique conversation ID (monotonic within the process lifetime). */
export function generateConvId(): string {
  return `conv-${Date.now()}-${++convCounter}`;
}

// ── Internal conversation state ────────────────────────────────────────────────

/**
 * Mutable backing store for a conversation.
 *
 * Accessed directly by the registry (via the `_state` property on the
 * returned object) for performance-sensitive hot paths.  All external
 * consumers read through the `getState()` snapshot method.
 */
export type MutableConvState = {
  id: string;
  agentName: string;
  title: string;
  isLoading: boolean;
  streamingText: string;
  /** Unified dual-buffer history tracker (live LLM context + full append-only record). */
  tracker: HistoryTracker;
};

/**
 * Extended conversation handle returned by `makeConversation`.
 *
 * In addition to the public `SubAgentConversation` interface, exposes
 * internal fields that the registry uses for direct state mutation and
 * fine-grained notification control.
 */
export type ConversationHandle = SubAgentConversation & {
  /** Direct reference to the mutable backing store. */
  _state: MutableConvState;
  /**
   * Notify only conversation subscribers.
   * For high-frequency updates (streaming text, token progress) that
   * should NOT propagate to the registry-level store.
   */
  _notify: () => void;
  /**
   * Notify conversation subscribers AND propagate to the registry.
   * For structural changes (history finalized, isLoading toggled).
   */
  _notifyRegistry: () => void;
};

/**
 * Create a new conversation with reactive state.
 *
 * @param conversationId  Unique conversation ID (use `generateConvId()`).
 * @param sessionId       Root session ID — becomes `id` in the state snapshot.
 * @param title           Human-readable title.
 * @param agentName       Name of the sub-agent that owns this conversation.
 * @param notifyRegistry  Callback to notify the parent registry of structural
 *                        changes (e.g. history finalized, isLoading toggled).
 * @param getExtraState   Optional function that returns additional fields to
 *                        merge into the snapshot (e.g. ToolSet-contributed
 *                        per-conversation state).
 *
 * @returns A `ConversationHandle` with both the public `SubAgentConversation`
 *          interface and internal `_state` / `_notify` / `_notifyRegistry`
 *          properties for use by the registry internals.
 */
export function makeConversation(
  conversationId: string,
  sessionId: string,
  title: string,
  agentName: string,
  notifyRegistry: () => void,
  getExtraState?: () => Partial<SubAgentConversationState>,
): ConversationHandle {
  const state: MutableConvState = {
    id: conversationId,
    agentName,
    title,
    isLoading: false,
    streamingText: '',
    tracker: createHistoryTracker(),
  };
  const subs = new Set<() => void>();
  let convSnapshot: SubAgentConversationState | undefined;

  /**
   * Notify only conversation subscribers (for live execution updates like
   * progress events, token updates, history changes during a turn).
   * Does NOT propagate to the registry — avoids flooding the registry's
   * useSyncExternalStore with updates that don't change its structural state.
   */
  function notifyConv(): void {
    convSnapshot = undefined;
    for (const fn of subs) fn();
  }

  /**
   * Notify conversation subscribers AND propagate to the registry.
   * Use for structural changes that should be reflected in the registry
   * snapshot (e.g. history finalized, isLoading toggled).
   */
  function notifyConvAndRegistry(): void {
    notifyConv();
    notifyRegistry();
  }

  return {
    _state: state,
    _notify: notifyConv,
    _notifyRegistry: notifyConvAndRegistry,

    getState(): SubAgentConversationState {
      if (!convSnapshot) {
        convSnapshot = {
          id: sessionId,
          agentName: state.agentName,
          conversationId: state.id,
          title: state.title,
          isLoading: state.isLoading,
          streamingText: state.streamingText,
          history: state.tracker.getFullHistory(),
          ...getExtraState?.(),
        } as SubAgentConversationState;
      }
      return convSnapshot;
    },

    subscribe(fn: () => void): () => void {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    getHistory(): AgentMessage[] {
      return state.tracker.getLiveHistory();
    },
  };
}
