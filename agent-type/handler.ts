import type { ToolDescriptor, ToolCall, ToolResult, AgentTurnResponse, AgentStreamChunk } from './core';
import type { AgentMessage, ToolChoice } from './message';

// ═══════════════════════════════════════════════════════════════════════════════
//  Handler context & agent handler  (来自 src/tools/types/context.ts)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Handler context ───────────────────────────────────────────────────────────

/**
 * Injected into every `AgentHandler` call.
 *
 * Provides a vendor-agnostic snapshot of tools and conversation state.
 * Use the standalone utility functions (`toOpenAIMessages`, `toOpenAITools`,
 * etc. exported from `@uap/agent-sdk`) if you need to format these for a
 * specific AI vendor API.
 */
export type HandlerContext = {
  /** Vendor-agnostic JSON Schema descriptors for all registered tools. */
  readonly tools: readonly ToolDescriptor[];

  /**
   * Execute a registered tool by name, with runtime argument validation.
   * Throws if the tool is not found or arguments fail validation.
   */
  readonly callTool: (call: ToolCall) => Promise<ToolResult>;

  /**
   * Controls which tool (if any) the model must call.
   * Defaults to `'auto'`. Set via `createAgentClient({ toolChoice: ... })`.
   */
  readonly toolChoice: ToolChoice;

  /**
   * System prompt forwarded from `createAgentClient({ systemPrompt })`.
   * Handlers should prepend this as a `{ role: 'system', content }` message
   * before passing the conversation history to the AI API.
   * `undefined` means the handler should use its own default or no system prompt.
   */
  readonly systemPrompt?: string;

  /**
   * Abort signal for the current handler invocation.
   * Pass to `fetch` (or any async operation) so the in-flight request is
   * cancelled when the user clicks Stop or the SDK interrupts the agent loop.
   *
   * @example
   * ```ts
   * const resp = await fetch(url, { signal: context.signal });
   * ```
   */
  readonly signal: AbortSignal;
};

// ── Agent handler ─────────────────────────────────────────────────────────────

/**
 * A function that drives one LLM turn.
 *
 * Receives the full conversation history and a `HandlerContext` (tools, abort
 * signal, system prompt, …) and returns either a structured response or a
 * `ReadableStream` of typed chunks for streaming.
 *
 * Defined here (alongside `HandlerContext`) to avoid circular imports:
 * `core.ts` imports `AgentHandler` from this file so that
 * `ToolExecutionContext` can carry a direct reference to the handler.
 *
 * NOTE: Imported by the ToolSet types in toolset.ts, which also resides in
 * agent-type — no cyclic dep across packages.
 */
export type AgentHandler = (
  messages: AgentMessage[],
  context: HandlerContext,
) => Promise<AgentTurnResponse | ReadableStream<AgentStreamChunk>>;
