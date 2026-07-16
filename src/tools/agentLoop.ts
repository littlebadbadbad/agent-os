import { toErrorMessage } from './errors';
import type { AgentStreamChunk, Attachment, TokenUsage, ToolCall, ToolResult } from '@agent-type';

// ── Hook interface ────────────────────────────────────────────────────────────

/**
 * Optional side-effect callbacks injected into `drainAgentStream`.
 *
 * `AgentSession` supplies these to perform state updates as the stream
 * progresses.  Pure callers (e.g. `runAgentLoop` inside a sub-agent) leave
 * this undefined — the function behaves identically but with no side-effects.
 */
export type AgentStreamHooks = {
  /**
   * Called for every text delta.
   * `hasSeenTool` is `false` while no tool call has been seen yet, and `true`
   * from the first `tool_call` / `tool_result` chunk onward.
   */
  onTextDelta?: (delta: string, hasSeenTool: boolean) => void;

  /**
   * Called for every thinking / reasoning delta.
   * `hasSeenTool` follows the same semantics as in `onTextDelta`.
   */
  onThinkingDelta?: (delta: string, hasSeenTool: boolean) => void;

  /**
   * Called exactly once when the first `tool_call` or `tool_result` chunk
   * arrives.  Use this to finalise the "pre-tool" assistant bubble in the UI
   * (e.g. set `isStreaming: false`).
   */
  onFirstToolSeen?: () => void;

  /**
   * Called for each handler-pre-executed `tool_result` chunk.
   * The SDK does NOT re-execute these — the handler already ran the tool and
   * is only asking the widget to *display* the result.
   */
  onPreExecutedResult?: (call: ToolCall, result: ToolResult) => void;

  /**
   * Called for each `attachment` chunk in the stream.
   * Use this to append a generated attachment to the current assistant bubble.
   */
  onAttachment?: (attachment: Attachment) => void;

  /**
   * Called right before awaiting tool execution results, with all assistant
   * content that has been accumulated from the stream so far (text, thinking,
   * and tool calls).
   *
   * In the streaming path, tool calls are dispatched immediately when
   * `tool_call` chunks arrive, but the results are awaited only after the
   * stream ends.  For suspending tools (e.g. `ask_user`), this await can
   * last indefinitely.  This hook lets callers persist the assistant message
   * (text, thinking, tool calls) *before* the tool results are known, so
   * in-flight turn data survives page reload even when tools are pending.
   *
   * `toolCalls` are the raw `ToolCall` objects from the stream (no results yet).
   */
  onBeforeAwaitResults?: (
    text: string,
    thinking: string,
    toolCalls: readonly ToolCall[],
  ) => void;
};

// ── Return type ───────────────────────────────────────────────────────────────

export type DrainResult = {
  /** All accumulated text content (pre-tool and post-tool concatenated). */
  text: string;
  /** All accumulated thinking / reasoning content. */
  thinking: string;
  /** Every tool call seen in the stream (SDK-executed + pre-executed). */
  toolCalls: ToolCall[];
  /**
   * Paired call + result for every completed tool invocation.
   * SDK-executed calls appear first, then pre-executed (tool_result) calls.
   */
  toolResultPairs: Array<{ call: ToolCall; result: ToolResult }>;
  /** Output attachments emitted by the handler (e.g. generated images). */
  attachments: Attachment[];
  /** Token usage reported via a `usage` chunk (if the handler emitted one). */
  usage?: TokenUsage;
  /**
   * `true` iff the SDK received ≥1 `tool_call` chunk.
   *
   * The caller should re-invoke the handler only when this is `true`, so the
   * model receives the tool results and can produce a grounded response.
   *
   * Post-tool text deltas are **not** treated as final — they are speculative
   * text generated before the tools completed.  The handler must be called
   * again with the actual tool results for a correct final response.
   *
   * - If the handler emitted `tool_result` chunks instead of `tool_call` chunks,
   *   it managed its own execution — no re-invocation needed.
   */
  shouldContinue: boolean;
};

// ── Core engine ───────────────────────────────────────────────────────────────

/**
 * Drain a structured `ReadableStream<AgentStreamChunk>`.
 *
 * This is the shared engine for **both** paths that process a streaming AI
 * response in this SDK:
 *
 * | Caller | `executeTool` | `hooks` |
 * |---|---|---|
 * | `AgentSession` | `runToolCall` (updates UI state) | state-update callbacks |
 * | `runAgentLoop` (sub-agent) | `callTool` (pure) | `undefined` |
 *
 * ### Parallel tool execution
 * `tool_call` chunks are dispatched to `executeTool` **immediately and without
 * awaiting** as they arrive in the stream.  This means tool executions run
 * concurrently with the remainder of the stream read, matching the production
 * behaviour of Claude, GPT-4o, and Gemini.  The results are collected via
 * `Promise.all` after the stream ends.
 *
 * ### Error isolation
 * If `executeTool` rejects, the error is caught and converted to a structured
 * error result so the conversation history remains consistent (every tool call
 * must have a matching result in the history).
 */
export async function drainAgentStream(
  stream: ReadableStream<AgentStreamChunk>,
  executeTool: (call: ToolCall) => Promise<ToolResult>,
  signal: AbortSignal,
  hooks?: AgentStreamHooks,
): Promise<DrainResult> {
  let text = '';
  let thinking = '';
  let hasSeenTool = false;
  let sdkExecutedAnyTool = false;
  let hasPostToolText = false;

  const allToolCalls: ToolCall[] = [];
  const outputAttachments: Attachment[] = [];
  let reportedUsage: TokenUsage | undefined;
  /** Promises started in parallel as tool_call chunks arrive. */
  const pending: Array<{ call: ToolCall; promise: Promise<ToolResult> }> = [];
  const preExecutedPairs: Array<{ call: ToolCall; result: ToolResult }> = [];

  const reader = stream.getReader();
  const onAbort = (): void => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;

      if (value.type === 'text') {
        text += value.delta;
        if (hasSeenTool) hasPostToolText = true;
        hooks?.onTextDelta?.(value.delta, hasSeenTool);

      } else if (value.type === 'thinking') {
        thinking += value.delta;
        hooks?.onThinkingDelta?.(value.delta, hasSeenTool);

      } else if (value.type === 'tool_call') {
        if (!hasSeenTool) {
          hasSeenTool = true;
          hooks?.onFirstToolSeen?.();
        }
        sdkExecutedAnyTool = true;
        allToolCalls.push(value.call);
        // Start without awaiting — runs in parallel with the rest of the stream
        const promise = executeTool(value.call).catch((err): ToolResult => ({
          toolCallId: value.call.id,
          name: value.call.name,
          result: `Error: ${toErrorMessage(err)}`,
        }));
        pending.push({ call: value.call, promise });

      } else if (value.type === 'tool_result') {
        if (!hasSeenTool) {
          hasSeenTool = true;
          hooks?.onFirstToolSeen?.();
        }
        allToolCalls.push(value.call);
        preExecutedPairs.push({ call: value.call, result: value.result });
        hooks?.onPreExecutedResult?.(value.call, value.result);

      } else if (value.type === 'attachment') {
        outputAttachments.push(value.attachment);
        hooks?.onAttachment?.(value.attachment);
      } else if (value.type === 'usage') {
        reportedUsage = value.usage;
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  // Collect all SDK-executed results — promises were started in parallel above.
  // Race against the abort signal so clicking "Stop" is immediately responsive
  // even if tool calls are still in flight. Pending promises continue to run in
  // the background (fire-and-forget) rather than being forcibly cancelled.
  const allResultsPromise = Promise.all(
    pending.map(async ({ call, promise }) => ({ call, result: await promise })),
  );
  let sdkPairs: Array<{ call: ToolCall; result: ToolResult }>;
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });

  // Notify caller before potentially-blocking tool-result await.
  // This lets the caller (agentLoopCore) construct the assistant history entry
  // and call onTurnSnapshot — critical for tools that suspend indefinitely
  // (e.g. ask_user via requestUserInput).
  hooks?.onBeforeAwaitResults?.(text, thinking, allToolCalls);

  sdkPairs = await Promise.race([allResultsPromise, abortPromise]);

  return {
    text,
    thinking,
    toolCalls: allToolCalls,
    toolResultPairs: [...sdkPairs, ...preExecutedPairs],
    attachments: outputAttachments,
    usage: reportedUsage,
    shouldContinue: sdkExecutedAnyTool && !hasPostToolText,
  };
}
