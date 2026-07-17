/**
 * Sub-agent registry public types.
 *
 * These types describe the observable state surface of the flat sub-agent
 * registry — designed so that UI layers can subscribe and render sub-agent
 * panels without depending on any internal implementation details.
 */

// ── Module augmentation ───────────────────────────────────────────────────────
export {};

declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Sub-agent registry for this session — `null` when no sub-agents exist. */
    subAgentRegistry: SubAgentRegistry | null;
  }
}

import type { AgentMessage } from '@agent-type';
import type { Attachment } from '@agent-type';
import type { PluginStateExtension, PluginUiAdapter } from '@agent-type';
import type { SubAgentResult } from './types';


// ── Serialization types (for persistence) ─────────────────────────────────────

/**
 * Serialisable snapshot of a single conversation — stored alongside the
 * parent session's message history so sub-agent data survives page reloads.
 */
export type SubAgentSerializedConversation = {
  id: string;
  /** Name of the sub-agent that owns this conversation. */
  agentName: string;
  title: string;
  /** ISO timestamp of when this conversation was created. */
  createdAt?: string;
  /** Full conversation history (all messages, for UI display). */
  history: AgentMessage[];
  /**
   * Compacted LLM context saved at snapshot time.
   * When present, this is fed to the model on the next API call instead of
   * `history`, preventing context-window overflow for long conversations.
   * Absent in old snapshots — falls back to `history` in that case.
   */
  liveHistory?: AgentMessage[];
  activeConversationId?: never; // discriminant guard — not an entry
};

/**
 * Serialisable snapshot of one sub-agent definition plus all its conversations.
 */
export type SubAgentSerializedEntry = {
  name: string;
  description: string;
  systemPrompt: string | undefined;
  toolNames: string[];
  maxTurns: number;
  parent: string;
  createdAt: string;
  activeConversationId: string;
  conversations: SubAgentSerializedConversation[];
};

// ── Message history ───────────────────────────────────────────────────────────

/**
 * A single message from a sub-agent conversation's history, augmented with
 * its stable zero-based index. Used by `readHistory` and `read_*_history` tool.
 *
 * Extends `AgentMessage` directly so UI layers can render it without any mapping.
 */
export type ConversationMessageEntry = AgentMessage & { readonly index: number };

// ── Conversation ──────────────────────────────────────────────────────────────

/**
 * Observable state for a single sub-agent conversation.
 *
 * Consumed by UI components to render streaming conversation panels,
 * token usage progress bars, and message history.
 *
 * Symbol-keyed plugin state is accessible via the `[key: symbol]` index
 * signature — UI layers look up state by the plugin's declared symbol,
 * fully generic with no hardcoded fields.
 */
export type SubAgentConversationState = {
  /** Root session ID (same for all sub-agent conversations within a session). */
  readonly id: string;
  /** Name of the sub-agent that owns this conversation. */
  readonly agentName: string;
  /**
   * Unique ID of this conversation (differs from `id` which is always
   * the root session ID).
   */
  readonly conversationId: string;
  /** Human-readable title (auto-generated or provided at creation). */
  readonly title: string;
  /** ISO timestamp of when this conversation was created. */
  readonly createdAt: string;
  /** Whether the sub-agent is currently executing a task in this conversation. */
  readonly isLoading: boolean;
  /**
   * Accumulated streaming text from the current turn's text_delta events.
   * Non-empty only while `isLoading` is true; reset to `''` at turn boundaries.
   * @deprecated Use {@code messages} instead — the ConversationRunner writes
   * streaming updates as {@code isStreaming} assistant messages.
   */
  readonly streamingText: string;
  /** Full message history — reactive, updates after each turn and after summarization. */
  readonly history: readonly AgentMessage[];
  /**
   * UI-facing messages — same {@link Message} type used by the main agent
   * session.  Includes streaming messages ({@code isStreaming: true}) and
   * tool-call result bubbles.  Replaces the old {@code streamingText} +
   * {@code agentMessagesToUI(history)} pattern.
   */
  readonly messages: import('@agent-sdk/tools/messageList').Message[];
  /**
   * Symbol-keyed plugin state slices.
   *
   * Each registered ToolSet that declares a `symbol` and implements
   * `onGetSymbolState` contributes its state here. UI layers look up
   * state by the plugin's symbol — no plugin-specific fields are
   * hardcoded on this type.
   */
  readonly [key: symbol]: PluginStateExtension & PluginUiAdapter;
};

/**
 * A live conversation within a sub-agent.
 * Exposes observable state and control methods.
 */
export type SubAgentConversation = {
  /** Returns the current observable state snapshot. */
  getState(): SubAgentConversationState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  /** The raw LLM-facing message history. Pass to `initialHistory` on the next call to continue. */
  getHistory(): AgentMessage[];
};

// ── Registry entries ──────────────────────────────────────────────────────────

/**
 * Read-only snapshot of one sub-agent entry in the registry.
 * Used for rendering the sub-agent management UI.
 *
 * Symbol-keyed plugin state is accessible via the `[key: symbol]` index
 * signature — UI layers look up state by the plugin's declared symbol,
 * fully generic with no hardcoded fields.
 */
export type SubAgentEntrySnapshot = {
  /** Registered tool name, e.g. `'researcher_agent'`. */
  readonly name: string;
  /** Description forwarded to the LLM. */
  readonly description: string;
  /** Optional system prompt for the sub-agent. */
  readonly systemPrompt: string | undefined;
  /** Tool names available to this sub-agent. */
  readonly toolNames: readonly string[];
  /** Maximum agentic turns per task. */
  readonly maxTurns: number;
  /**
   * Identifier of the parent that created this sub-agent.
   * Format: `"<agentName>:<conversationId>"` or `"<agentName>:main"` for root.
   * Used for display/tracing only — sub-agents are stored flat.
   */
  readonly parent: string;
  /** ISO timestamp of when this sub-agent was registered. */
  readonly createdAt: string;
  /** ID of the currently active conversation. */
  readonly activeConversationId: string;
  /** All conversations for this sub-agent, ordered oldest-first. */
  readonly conversations: readonly SubAgentConversationState[];
  /**
   * Symbol-keyed plugin state slices (agent-level).
   *
   * Each registered ToolSet that declares a `symbol` and implements
   * `onGetSymbolState` contributes its state here. UI layers look up
   * state by the plugin's symbol — no plugin-specific fields are
   * hardcoded on this type.
   */
  readonly [key: symbol]: PluginStateExtension & PluginUiAdapter;
};

/** Observable state of the entire sub-agent registry. */
export type SubAgentRegistryState = {
  readonly subAgents: readonly SubAgentEntrySnapshot[];
};

// ── Registry interface ────────────────────────────────────────────────────────

/**
 * Public interface of the flat sub-agent registry.
 *
 * All mutations are synchronous and immediately trigger subscribers.
 * Task execution (`sendTask`) is async but state updates are pushed reactively.
 *
 * Intended to be:
 * - Held by `createSubAgentMetaTools` to back the 8 meta-tools.
 * - Exposed on the return value of `createSubAgentMetaTools` for programmatic
 *   and UI access (e.g. a future SubAgent management panel).
 */
export type SubAgentRegistry = {
  /**
   * Human-readable label identifying which agent mode this registry belongs to
   * (e.g. "async-agent", "stream-agent").
   */
  readonly label: string;
  /** Returns the current observable state snapshot. */
  getState(): SubAgentRegistryState;
  /** Subscribe to any state change. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;

  // ── Sub-agent CRUD ──────────────────────────────────────────────────────

  /**
   * Register a new sub-agent definition.
   * Automatically creates the first default conversation.
   * Throws if a sub-agent with the same name already exists.
   */
  createSubAgent(params: {
    name: string;
    description: string;
    systemPrompt?: string;
    toolNames: readonly string[];
    maxTurns: number;
    parent: string;
  }): SubAgentConversation;

  /**
   * Update a sub-agent definition.
   * Only the provided fields are overwritten; omit fields to keep existing values.
   * Re-registers the sub-agent tool on all parent agents.
   * Throws if the sub-agent does not exist.
   */
  updateSubAgent(
    name: string,
    patch: Partial<{
      description: string;
      systemPrompt: string | undefined;
      toolNames: readonly string[];
      maxTurns: number;
    }>,
  ): void;

  /**
   * Remove a sub-agent and all its conversations.
   * Calls ToolSet `onRemoveSession` for every conversation.
   * Throws if the sub-agent does not exist.
   */
  deleteSubAgent(name: string): void;

  // ── Conversation CRUD ───────────────────────────────────────────────────

  /**
   * Create a new conversation for a sub-agent and set it as active.
   * Calls ToolSet `onInitSession` for the new conversation.
   * Throws if the sub-agent does not exist.
   */
  createConversation(subAgentName: string, options?: { title?: string; setActive?: boolean }): SubAgentConversation;

  /**
   * Delete a specific conversation.
   * Activates the nearest remaining conversation; creates a default one if the
   * last conversation was deleted.
   * Calls ToolSet `onRemoveSession` for the deleted conversation.
   * Throws if the sub-agent or conversation does not exist.
   */
  deleteConversation(subAgentName: string, conversationId: string): void;

  /**
   * Switch the active conversation for a sub-agent.
   * Throws if the sub-agent or conversation does not exist.
   */
  setActiveConversation(subAgentName: string, conversationId: string): void;

  /**
   * Clear the history of a specific conversation.
   * Calls ToolSet `onResetSession` for the conversation.
   * Throws if the sub-agent or conversation does not exist.
   */
  clearConversationHistory(subAgentName: string, conversationId: string): void;

  // ── Internal: execution dispatch ────────────────────────────────────────

  /**
   * Send a message to a specific conversation of a sub-agent.
   * Appends the message as a user turn, runs the agent loop, persists the
   * resulting history, and returns the final assistant response.
   * For internal use by tools; UI should prefer calling this directly too.
   */
  sendMessage(
    subAgentName: string,
    conversationId: string,
    message: string,
    options: {
      /**
       * Parent session ID for registry keying.
       * Forwarded to `runAgentLoop` so that tools executed by the sub-agent
       * (including nested `create_*_subagent` calls) register with the root
       * session's registry and appear in the UI alongside their siblings.
       */
      sessionId: string;
      signal: AbortSignal;
      /**
       * Multimodal content to attach to the opening user turn.
       * Resolved from variable handles by the caller before invocation.
       */
      attachments?: readonly Attachment[];
    },
  ): Promise<SubAgentResult>;

  /**
   * Read the message history of a specific conversation.
   * Each entry carries a stable `index` so callers can request only new messages.
   *
   * @param fromIndex - Start from this 0-based index (default: 0 = entire history).
   * @param maxMessages - Cap on messages returned (default: unbounded).
   */
  readHistory(
    subAgentName: string,
    conversationId: string,
    fromIndex?: number,
    maxMessages?: number,
  ): ConversationMessageEntry[];

  /**
   * Get a live conversation handle for direct observation and control.
   * Returns `undefined` if the sub-agent or conversation does not exist.
   */
  getConversation(subAgentName: string, conversationId: string): SubAgentConversation | undefined;

  /**
   * Send a user message to a specific sub-agent conversation from the UI.
   *
   * Aborts any in-flight call for the same conversation before starting,
   * so the UI never has two concurrent runs in the same conversation.
   * The returned promise resolves when the sub-agent finishes its agent loop.
   */
  sendConversationMessage(
    agentName: string,
    conversationId: string,
    message: string,
    attachments?: readonly Attachment[],
  ): Promise<void>;
  /**
   * Abort an in-flight `sendConversationMessage` call.
   * No-op if no message is currently in flight for that conversation.
   */
  cancelConversationMessage(agentName: string, conversationId: string): void;

  /**
   * Edit a user message in a specific sub-agent conversation from the UI.
   *
   * Finds the `userCount`-th user message (1-based) in the conversation's
   * full history, destructively discards that message and everything after it,
   * then sends `newText` (with optional `attachments`) as the replacement.
   *
   * Aborts any in-flight call for the same conversation before starting.
   * All ToolSet lifecycle hooks fire identically to a normal send.
   */
  editConversationMessage(
    agentName: string,
    conversationId: string,
    /** 1-based index counting only real user messages in the full history. */
    userCount: number,
    newText: string,
    attachments?: readonly Attachment[],
  ): Promise<void>;

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Return a serialisable snapshot of all sub-agents and their conversations.
   * Suitable for inclusion in `SessionEntryData.subAgents` and writing to
   * external storage.
   */
  getSnapshot(): SubAgentSerializedEntry[];

  /**
   * Restore the registry from a previously saved snapshot.
   * Replaces all current entries — call only during session initialisation.
   * ToolSet session lifecycle hooks (e.g. todo) are re-fired per conversation
   * so per-conversation state is fully reconstructed.
   */
  loadSnapshot(entries: SubAgentSerializedEntry[]): void;

  /**
   * Return the live `SubAgentConversation` handle for a specific conversation.
   * The UI layer uses this to subscribe to state changes and read history.
   * Returns `undefined` when the sub-agent or conversation does not exist.
   */
  getConversation(
    subAgentName: string,
    conversationId: string,
  ): SubAgentConversation | undefined;
};
