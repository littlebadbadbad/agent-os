import type { WidgetHandler, ToolCall, ToolResult, AgentMessage, Attachment, TokenUsage, AgentSessionExtension, AgentSessionState } from '@agent-type';
import type { TokenBudgetState } from "@agent-sdk/tools/track/tokenTracker";
import type { CompactionResult, AgentRunOutcome } from '@agent-type';
import type { TerminalManagerAdapter } from "@agent-sdk/tools/terminal";
import type { ToolStateEntry } from "@agent-sdk/client/types";
import type { TodoItem } from "@agent-sdk/tools/todo";
import type { SubAgentRegistry } from "@agent-sdk/tools/subagent/registryTypes";
import type { Message } from "../../agent-UI/components/AgentWidget/types";

// ── State ─────────────────────────────────────────────────────────────────────
// AgentSessionState is defined in @agent-type/core.ts.
// ToolSets contribute extra fields via `declare module '@agent-type' { interface AgentSessionExtension { ... } }`.
export type { AgentSessionState } from '@agent-type';

// ── Module augmentation ───────────────────────────────────────────────────────
// UI-specific session state fields. Business-module fields (toolStates, todos,
// tokenBudget, adapters, subAgentRegistries) are augmented by their own modules.
declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Conversation messages (UI Message format — richer than AgentMessage). */
    messages: Message[];
    /** Unique ID used to persist this widget's ball position in localStorage. */
    agentId: string | undefined;
    /** Human-readable title for this session (shown in the session list). */
    title: string;
    /** Whether the file-attachment button is shown in the chat input. */
    enableAttachments: boolean;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export type AgentSessionConfig = {
  /**
   * Getter for the current handler — always called at the moment a turn starts.
   * Using a getter rather than a stored reference keeps the session fresh when
   * the handler's internal context changes (e.g. new tools registered after
   * session creation).
   *
   * @param userMessage - The raw user message text for this turn, or `undefined`
   *   for headless/programmatic invocations.  Forwarded to each ToolSet's
   *   `onGetSystemPrompt` hook so they can decide what to inject.
   */
  getHandler: (userMessage?: string) => WidgetHandler;
  /** Unique ID of this session. */
  id: string;
  /** Unique ID forwarded to the widget for per-instance ball-position persistence. */
  agentId?: string;
  /** Human-readable title for this session. */
  title?: string;
  /** Executes a tool call (injected by the agent client or directly by callers). */
  callTool: (
    call: ToolCall,
    signal: AbortSignal,
  ) => Promise<ToolResult>;
  /** Maximum agentic turns per user message. Defaults to 10. */
  maxAgentTurns: number;
  /**
   * Called after every agent turn with the full history and token usage.
   *
   * Composed from all registered ToolSets' `onAfterTurn` hooks by the agent
   * client.  When a ToolSet returns a `CompactionResult`, the session replaces
   * its history and injects a "_Context compressed_" UI message.
   *
   * Omit (or return `undefined`) to leave the history unchanged.
   */
  onAfterTurn?: (
    history: AgentMessage[],
    usage: TokenUsage | undefined,
    signal: AbortSignal,
  ) => Promise<CompactionResult | void>;

  // ── External state slices ────────────────────────────────────────────────
  // The session subscribes to these stores and merges their snapshots into
  // `AgentSessionState`, so the widget only needs one subscription to react
  // to all state changes.

  /**
   * Generic external state slice — merged into session state on every change.
   *
   * `prevState` is the current session state at the moment of the call,
   * forwarded to each ToolSet's `onGetState` so they can patch existing fields
   * (e.g. inserting messages into the chat history).  `undefined` on the
   * initial construction call (no prior state exists yet).
   */
  getExternalState: (prevState?: AgentSessionState) => Partial<AgentSessionState>;
  subscribeExternalState: (fn: () => void) => () => void;
  /**
   * Initial conversation history to restore on session creation.
   * Used to hydrate the UI message list (full conversation display).
   * The LLM context on the first turn is taken from `liveHistory` when present,
   * falling back to `initialMessages` for backward compatibility.
   */
  initialMessages?: AgentMessage[];
  /**
   * Compacted LLM context to restore on session creation.
   * When provided the first API call uses this as its history rather than the
   * full `initialMessages`, preventing context-window overflow for long
   * conversations that were compacted before serialization.
   */
  liveHistory?: AgentMessage[];
  /** Whether to show the file-attachment button in the chat input. */
  enableAttachments: boolean;

  // ── Action callbacks ─────────────────────────────────────────────────────
  onClearHistory: () => void;
  onBeforeRun?: (history: readonly AgentMessage[]) => void;
  /**
   * Called before each LLM invocation (every turn of the agent loop).
   * Return pending user messages to inject into the conversation history
   * before this turn's handler call.
   */
  onBeforeInvoke?: () => AgentMessage[];
  /**
   * Called once after the entire agent run finishes (success, max-turns, abort, or error).
   * Composed from all registered ToolSets' `onAfterRun` hooks by the agent client.
   */
  onAfterRun?: (outcome: AgentRunOutcome) => void;
};

// ── Session interface ─────────────────────────────────────────────────────────

export type AgentSession = {
  /** Send a user message and run the full agentic loop. */
  sendMessage(text: string, attachments?: readonly Attachment[]): Promise<void>;
  /**
   * Edit an existing user message (identified by UI `messageId`) and re-send it.
   *
   * Truncates the conversation at that message, pushes the new text as a fresh
   * user message, and runs the full agentic loop again.
   */
  editAndSendMessage(messageId: string, newText: string, attachments?: readonly Attachment[]): Promise<void>;
  /** Abort any in-flight handler/tool call. */
  cancelMessage(): void;
  /** Clear message history. */
  clearHistory(): void;
  /** Update the session's human-readable title (mirrors `sessionManager.renameSession`). */
  setTitle(title: string): void;
  /** Returns the current snapshot of all session state. */
  getState(): AgentSessionState;
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
   * when compaction has occurred.  Used by `buildSnapshot` so the persisted
   * `liveHistory` field always reflects the current context-window state.
   */
  getLiveHistory(): AgentMessage[];
};
