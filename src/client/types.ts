import type { AgentHandler } from '@agent-type';
import type { ToolChoice, Tool } from '@agent-type';
import type { ToolSet } from '@agent-type';
import type { AgentSession } from './agentSession';
import type { SessionEntryData, SessionManager } from './sessionManager.types';

// ── Config ────────────────────────────────────────────────────────────────────

export type AgentClientConfig = {
  /** Unique ID used to persist this widget's ball position in localStorage. */
  id?: string;
  handler: AgentHandler;
  /**
   * Minimum interval between handler invocations in milliseconds.
   * If a second call is made before this interval has elapsed, it will wait
   * until the interval is satisfied before invoking the handler.
   * Defaults to 1000ms.
   */
  handlerThrottleMs?: number;
  /**
   * System prompt sent to the AI on every turn.
   * Forwarded as `context.systemPrompt` to handlers so they can prepend it
   * as a `{ role: 'system' }` message before calling the AI API.
   * Omit to let the handler use its own default prompt.
   */
  systemPrompt?: string;
  /**
   * Default tool-choice mode forwarded to every handler call.
   * Mirrors the `tool_choice` parameter of OpenAI / Anthropic / Gemini APIs.
   * Defaults to `'auto'`.
   */
  toolChoice?: ToolChoice;
  /**
   * Maximum number of handler invocations (agentic turns) per user message.
   * Each turn may include tool calls; the loop continues until the model
   * produces a response with no tool calls or this limit is reached.
   * Defaults to `10`.
   */
  maxAgentTurns?: number;
  /**
   * Whether to show the file-attachment button in the chat input.
   * Set to `false` for models that do not support multimodal input
   * (e.g. text-only LLMs) to prevent users from attaching files that
   * the model cannot process.
   * Defaults to `true`.
   */
  enableAttachments?: boolean;
  /**
   * Tools to register at initialization.
   *
   * A convenient alternative to `registerTool()` for tools that are known
   * at construction time.
   *
   * @example
   * ```ts
   * const agent = createAgentClient({
   *   handler,
   *   tools: [myTool, anotherTool],
   * });
   * ```
   */
  tools?: Tool[];
  /**
   * Tool sets to register at initialization.
   *
   * Each tool set contributes tools and optional session lifecycle hooks
   * (init, reset, remove) and a state slice that is merged into every
   * session's `AgentSessionState`.
   *
   */
  toolSets?: ToolSet[];
  /**
   * Custom UI renderer.  When supplied, `agent.render()` calls this instead of
   * mounting the built-in React widget.
   *
   * The function receives the live `SessionManager` (all sessions and the active
   * session are accessible via `sessionManager.getState()`) and the target DOM
   * container.  It must return a cleanup function that tears down the UI when called.
   *
   * For single-session scenarios or backward-compat with older code that receives
   * an `AgentSession`, check the type at runtime:
   * ```ts
   * renderUI: (context, container) => {
   *   const session = 'createSession' in context
   *     ? context.getActiveSession()!
   *     : context;
   *   ...
   * }
   * ```
   *
   * @example
   * ```ts
   * // Minimal vanilla-JS example
   * const agent = createAgentClient({
   *   handler,
   *   renderUI: (sessionManager, container) => {
   *     const render = () => {
   *       const { sessions, activeSessionId } = sessionManager.getState();
   *       const msgs = sessions.find(s => s.id === activeSessionId)
   *         ?.session.getState().messages ?? [];
   *       container.innerHTML = msgs.map(m => m.content).join('<hr/>');
   *     };
   *     render();
   *     return sessionManager.subscribe(render);
   *   },
   * });
   * ```
   */
  renderUI?: (context: SessionManager, container: HTMLElement) => () => void;
  // ── Multi-session options ─────────────────────────────────────────────────
  /**
   * Static list of sessions to create at initialization.
   * Each entry becomes an independent session with its own message history,
   * tool toggle states, and tool-specific state.
   */
  initialSessions?: SessionEntryData[];
  /**
   * Called whenever any session data changes (messages, tool states,
   * session list mutations).  Receives a full serialisable snapshot of every
   * live session — ideal for persistence.
   *
   * Calls are debounced (~500 ms) so streaming tokens don't trigger a write
   * per chunk.
   *
   * @example
   * ```ts
   * createAgentClient({
   *   handler,
   *   initialSessions: loadSessions('my-agent'),
   *   onSessionsChange: (sessions) =>
   *     localStorage.setItem('my-agent-sessions', JSON.stringify(sessions)),
   * });
   * ```
   */
  onSessionsChange?: (sessions: SessionEntryData[], force?: boolean) => void | Promise<void>;
};

// ── Tool state ────────────────────────────────────────────────────────────────

/** A single tool's state as surfaced to the widget UI. */
export type ToolStateEntry = {
  name: string;
  description: string;
  enabled: boolean;
  /** Optional group name — tools with the same group are shown together in the UI. */
  group?: string;
};
