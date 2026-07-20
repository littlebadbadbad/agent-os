/**
 * Unified conversation-session abstraction.
 *
 * Both the main `AgentSession` and every sub-agent `ConversationHandle`
 * produce the same shape of observable state and expose the same control
 * surface (`sendMessage`, `cancelMessage`, `subscribe`, etc.).
 *
 * This module defines the shared interface so UI layers, plugin slots, and
 * persistence code can treat every "chat" uniformly — whether it is the
 * main session or a sub-agent conversation.
 */

import type { Attachment, AgentMessage } from '@agent-type';
import type { PluginStateExtension } from '@agent-type';
import type { Message } from '../utils/shared';

// ── Session state ─────────────────────────────────────────────────────────────

/**
 * Observable state of any conversation session.
 *
 * Every field prefixed with a `readonly` modifier — consumers read snapshots
 * via `getState()` and react to changes via `subscribe()`.
 *
 * Symbol-keyed plugin state is accessible via the `[key: symbol]` index
 * signature — UI layers look up state by the plugin's declared symbol,
 * fully generic with no hardcoded fields.
 */
export type ConversationSessionState = {
  /** Root session ID (same for all conversations within a session). */
  readonly id: string;
  /** Name of the agent that owns this conversation. */
  readonly agentName: string;
  /**
   * Unique ID of this conversation.
   *
   * - Main agent: always `MAIN_CONVERSATION_ID` (`"main"`).
   * - Sub-agent: per-conversation unique ID.
   */
  readonly conversationId: string;
  /** Human-readable title. */
  readonly title: string;
  /** Whether the agent is currently executing a task in this conversation. */
  readonly isLoading: boolean;
  /**
   * Accumulated streaming text from the current turn's text_delta events.
   * Non-empty only while `isLoading` is true; reset to `''` at turn boundaries.
   */
  readonly streamingText: string;
  /**
   * UI-ready message list.
   *
   * Derived from the underlying history tracker at snapshot time.
   * Each message gets a stable `id` so the virtualizer can key on it.
   */
  readonly messages: readonly Message[];
  /**
   * Symbol-keyed plugin state slices.
   *
   * Each registered ToolSet that declares a `symbol` and implements
   * `onGetSymbolState` contributes its state here. UI layers look up
   * state by the plugin's symbol — no plugin-specific fields are
   * hardcoded on this type.
   */
  readonly [key: symbol]: PluginStateExtension;
};

// ── Session interface ─────────────────────────────────────────────────────────

/**
 * A single conversation session — the core abstraction this SDK revolves
 * around.
 *
 * Whether it's the top-level main session or a sub-agent conversation, the
 * contract is identical:
 *
 *   1. Call `sendMessage(text)` to start an agentic turn.
 *   2. Subscribe to state changes via `subscribe(fn)` (compatible with
 *      React's `useSyncExternalStore`).
 *   3. Read the latest snapshot via `getState()`.
 *   4. Cancel an in-flight turn via `cancelMessage()`.
 *   5. Edit a previous user message via `editAndSendMessage()`.
 *   6. Retrieve raw LLM-facing history via `getHistory()` / `getLiveHistory()`.
 */
export type ConversationSession = {
  /** Send a user message and run the full agentic loop. */
  sendMessage(text: string, attachments?: readonly Attachment[]): Promise<void>;
  /**
   * Edit an existing user message (identified by UI `messageId`) and re-send it.
   *
   * Truncates the conversation at that message, pushes the new text as a fresh
   * user message, and runs the full agentic loop again.
   */
  editAndSendMessage(
    messageId: string,
    newText: string,
    attachments?: readonly Attachment[],
  ): Promise<void>;
  /** Abort any in-flight handler/tool call. */
  cancelMessage(): void;
  /** Clear message history. */
  clearHistory(): void;
  /** Returns the current snapshot of all session state. */
  getState(): ConversationSessionState;
  /**
   * Subscribe to state changes.  Returns an unsubscribe function.
   * Compatible with React's `useSyncExternalStore`.
   */
  subscribe(fn: () => void): () => void;
  /** Returns the raw LLM-facing message history (for serialization/persistence). */
  getHistory(): AgentMessage[];
  /**
   * Returns the current compacted LLM context — the history array that will be
   * sent to the model on the next API call.  May be shorter than `getHistory()`
   * when compaction has occurred.
   */
  getLiveHistory(): AgentMessage[];
};
