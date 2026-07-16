/** Core agentic turn loop shared by AgentSession and sub-agent conversations. */

import { drainAgentStream } from './agentLoop';
import { isAgentTurnResponse, resolveToolField } from './types';
import { toErrorMessage } from './errors';
import type { AgentStreamHooks } from './agentLoop';
import type {
  AgentMessage,
  ToolCall,
  ToolResult,
  TokenUsage,
  AgentTurnResponse,
  AgentStreamChunk,
  Tool,
} from '@agent-type';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Lifecycle hooks for `runAgentLoopCore`.
 * All fields are optional — provide only what you need.
 *
 * Streaming hooks (`onTextDelta`, `onThinkingDelta`, `onFirstToolSeen`,
 * `onPreExecutedResult`, `onAttachment`) are inherited from `AgentStreamHooks`
 * and forwarded directly to `drainAgentStream`.
 */
export type AgentLoopHooks = AgentStreamHooks & {
  /**
   * Called at the start of each turn, before the LLM is invoked.
   * `turn` is 0-indexed. Use this to set up per-turn UI state —
   * e.g. add a streaming placeholder message for turns > 0.
   */
  onTurnBegin?(turn: number): void;

  /**
   * Called with the final assistant text for non-streaming responses.
   * Not called in the streaming path — use `onTextDelta` there instead.
   */
  onAssistantText?(text: string, thinking: string | null | undefined): void;

  /**
   * Called immediately after a streaming response finishes draining.
   * Use this to flush any buffered content (e.g. batched React state updates).
   */
  onStreamEnd?(): void;

  /**
   * Called just before parallel tool execution begins for a turn.
   * `calls` is an immutable snapshot of all tool calls for this turn.
   */
  onBeforeToolCalls?(calls: readonly ToolCall[]): void;

  /** Called right before tool execution with a fresh copy of the current turn's history. */
  onTurnSnapshot?(history: AgentMessage[]): void;

  /**
   * Called after each individual tool call completes (success or error result).
   * Not called for handler-pre-executed tool calls — use `onPreExecutedResult` for those.
   */
  onAfterToolCall?(call: ToolCall, result: ToolResult): void;

  /**
   * Called at the end of every complete turn — after assistant text is produced
   * and all tool results are appended to history.
   *
   * Return a new `AgentMessage[]` to replace the current history
   * (e.g. after compaction or summarisation). Returning `void` / `undefined`
   * keeps the existing history unchanged.
   */
  /**
   * Called before every `invokeHandler` (LLM call), giving the caller a chance
   * to inject additional user messages into the current turn's history.
   *
   * Returned messages are appended to `history` immediately before the handler
   * is invoked, so the model receives them as part of this turn's context.
   *
   * Use this for user-pending-input interjection — when the user types a
   * message while the agent is running, queue it here and drain it on the
   * next loop iteration.
   */
  onBeforeInvoke?(): AgentMessage[];

  onAfterTurn?(
    history: AgentMessage[],
    usage: TokenUsage | undefined,
    signal: AbortSignal,
  ): Promise<AgentMessage[] | void>;
};

export type AgentLoopCoreConfig = {
  /**
   * Starting history. The current user message should already be appended
   * as the last entry before calling `runAgentLoopCore`.
   */
  initialHistory: readonly AgentMessage[];
  /** Maximum number of handler invocations (turns) before stopping. */
  maxTurns: number;
  /** AbortSignal forwarded to the handler and tool calls. */
  signal: AbortSignal;
  /**
   * Invoke the LLM for one turn.
   * Receives a snapshot of the full history and the active signal.
   * May rebuild HandlerContext on each call to pick up tool changes
   * since the previous turn.
   */
  invokeHandler(
    history: readonly AgentMessage[],
    signal: AbortSignal,
  ): Promise<AgentTurnResponse | ReadableStream<AgentStreamChunk>>;
  /**
   * Execute a single tool call.
   * Callers may wrap this with UI concerns (updating the message list,
   * showing spinners, etc.) — the core loop cares only about the result.
   */
  callTool(call: ToolCall): Promise<ToolResult>;
  /**
   * Optional: resolve a tool by name to inspect its metadata.
   *
   * When provided, the loop uses the tool's `isConcurrencySafe` and
   * `interruptBehavior` flags to decide execution ordering:
   * - Concurrency-safe tools run in parallel.
   * - Non-concurrency-safe tools are serialised.
   * - Tools with `interruptBehavior === 'cancel'` that are still running
   *   when the abort signal fires may be discarded.
   *
   * When omitted (default), all tools run in parallel — preserving the
   * original behaviour for backward compatibility.
   */
  resolveTool?(name: string): Tool | undefined;
  /** Optional lifecycle hooks. */
  hooks?: AgentLoopHooks;
};

export type AgentLoopCoreResult = {
  /** Final assistant text from the last turn. */
  output: string;
  /** Number of assistant turns (handler invocations that produced a response). */
  turns: number;
  /** Total tool calls executed across all turns. */
  toolCallCount: number;
  /** Full conversation history after execution. */
  history: AgentMessage[];
  /**
   * `true` when the loop ended naturally (model produced no tool calls, or the
   * stream indicated no continuation needed).
   * `false` when `maxTurns` was hit or the signal was aborted before natural completion.
   */
  completed: boolean;
};

// ── Engine ─────────────────────────────────────────────────────────────────────

export async function runAgentLoopCore(config: AgentLoopCoreConfig): Promise<AgentLoopCoreResult> {
  const { maxTurns, signal, invokeHandler, callTool, hooks = {}, resolveTool } = config;
  const {
    onTurnBegin,
    onBeforeInvoke,
    onTurnSnapshot,
    onAssistantText,
    onStreamEnd,
    onBeforeToolCalls,
    onAfterToolCall,
    onAfterTurn,
    // AgentStreamHooks forwarded directly to drainAgentStream:
    onTextDelta,
    onThinkingDelta,
    onFirstToolSeen,
    onPreExecutedResult,
    onAttachment,
  } = hooks;

  let history: AgentMessage[] = [...config.initialHistory];
  let totalToolCalls = 0;
  let finalText = '';
  let completed = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal.aborted) break;

    onTurnBegin?.(turn);

    // Inject pending user messages queued during the previous turn's tool
    // execution (e.g. user interjected while agent was processing).
    const pendingMessages = onBeforeInvoke?.() ?? [];
    if (pendingMessages.length > 0) {
      history.push(...pendingMessages);
    }

    const result = await invokeHandler([...history], signal);

    if (isAgentTurnResponse(result)) {
      // ── Non-streaming path ──────────────────────────────────────────────────
      finalText = result.text;
      const turnToolCalls = result.toolCalls ? [...result.toolCalls] : [];

      onAssistantText?.(result.text, result.thinking ?? null);

      history.push({
        role: 'assistant',
        content: result.text,
        // Preserve thinking / reasoning_content so thinking models can echo it
        // back. Use != null (not &&) so empty-string thinking is still included.
        ...(result.thinking != null ? { thinking: result.thinking } : {}),
        ...(turnToolCalls.length && { toolCalls: turnToolCalls }),
      });

      if (turnToolCalls.length === 0) {
        // Natural completion — model finished without requesting any tools.
        if (onAfterTurn) {
          const compacted = await onAfterTurn([...history], result.usage, signal);
          if (compacted) history = [...compacted];
        }
        completed = true;
        break;
      }

      // Expose a snapshot of the current history so the caller (e.g.
      // ConversationRunner) can persist in-flight turn data before
      // potentially-suspending tool execution begins.
      onTurnSnapshot?.([...history]);

      onBeforeToolCalls?.(turnToolCalls);

      // Execute tool calls, partitioning by concurrency safety.
      // Safe calls → parallel; unsafe calls → serial.
      const executeOne = async (call: ToolCall): Promise<ToolResult> => {
        try {
          const res = await callTool(call);
          onAfterToolCall?.(call, res);
          return res;
        } catch (err) {
          const res: ToolResult = {
            toolCallId: call.id,
            name: call.name,
            result: `Error: ${toErrorMessage(err)}`,
          };
          onAfterToolCall?.(call, res);
          return res;
        }
      };

      const isCallConcurrencySafe = (call: ToolCall): boolean => {
        if (!resolveTool) return true; // default: all safe (backward compat)
        const tool = resolveTool(call.name);
        if (!tool) return true;
        return resolveToolField(tool.isConcurrencySafe, call.arguments, false);
      };

      const toolResults: ToolResult[] = [];
      if (turnToolCalls.every(isCallConcurrencySafe)) {
        // Fast path: all calls are safe → parallel.  Race against the abort
        // signal so cancellation is responsive rather than waiting for all
        // tools to finish.
        if (signal.aborted) break;
        const results = await Promise.race([
          Promise.all(turnToolCalls.map(executeOne)),
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }),
          ),
        ]);
        toolResults.push(...results);
      } else {
        // Mixed or all-unsafe: run safe calls in a parallel batch, then
        // unsafe calls serially (one at a time).
        const safeCalls = turnToolCalls.filter(isCallConcurrencySafe);
        const unsafeCalls = turnToolCalls.filter((c) => !isCallConcurrencySafe);

        if (safeCalls.length > 0) {
          // Safe batch — parallel (no abort race needed; the signal check
          // before each serial step is sufficient).
          const safeResults = await Promise.all(safeCalls.map(executeOne));
          toolResults.push(...safeResults);
        }

        for (const call of unsafeCalls) {
          if (signal.aborted) break;
          toolResults.push(await executeOne(call));
        }
      }

      totalToolCalls += toolResults.length;
      for (const res of toolResults) {
        history.push({
          role: 'tool',
          toolCallId: res.toolCallId,
          name: res.name,
          content: res.result,
          ...(res.attachments?.length ? { attachments: res.attachments } : {}),
        });
      }

      if (onAfterTurn) {
        const compacted = await onAfterTurn([...history], result.usage, signal);
        if (compacted) history = [...compacted];
      }
    } else {
      // ── Streaming path ──────────────────────────────────────────────────────
      // Track pre-executed call IDs so onAfterToolCall fires only for
      // SDK-executed calls (pre-executed ones are covered by onPreExecutedResult).
      const preExecutedIds = new Set<string>();

      const streamingHooks = {
        onTextDelta,
        onThinkingDelta,
        onFirstToolSeen,
        onPreExecutedResult: (call: import('@agent-type').ToolCall, res: import('@agent-type').ToolResult) => {
          preExecutedIds.add(call.id);
          onPreExecutedResult?.(call, res);
        },
        onAttachment,
        onBeforeAwaitResults: (
          streamText: string,
          streamThinking: string,
          streamToolCalls: readonly import('@agent-type').ToolCall[],
        ) => {
          // Construct what the assistant message WILL look like once all tool
          // results arrive — text, thinking, and toolCalls are already known.
          const snapshot: import('@agent-type').AgentMessage[] = [
            ...history,
            {
              role: 'assistant',
              content: streamText,
              ...(streamThinking ? { thinking: streamThinking } : {}),
              ...(streamToolCalls.length ? { toolCalls: [...streamToolCalls] } : {}),
            },
          ];
          onTurnSnapshot?.(snapshot);
        },
      };

      const { text, thinking, toolCalls, toolResultPairs, attachments, usage, shouldContinue } =
        await drainAgentStream(result, callTool, signal, streamingHooks);

      onStreamEnd?.();
      finalText = text;

      if (onAfterToolCall) {
        for (const { call, result: res } of toolResultPairs) {
          if (!preExecutedIds.has(call.id)) onAfterToolCall(call, res);
        }
      }

      history.push({
        role: 'assistant',
        content: text,
        ...(thinking ? { thinking } : {}),
        ...(toolCalls.length && { toolCalls }),
        ...(attachments.length && { attachments }),
      });
      for (const { call, result: res } of toolResultPairs) {
        history.push({
          role: 'tool',
          toolCallId: res.toolCallId,
          name: call.name,
          content: res.result,
          ...(res.attachments?.length ? { attachments: res.attachments } : {}),
        });
      }
      totalToolCalls += toolCalls.length;

      if (onAfterTurn) {
        const compacted = await onAfterTurn([...history], usage, signal);
        if (compacted) history = [...compacted];
      }

      // When tool calls were made, always continue — post-tool text is
      // speculative (generated before tools completed). The model needs
      // another turn with actual tool results to produce a grounded response.
      if (!shouldContinue) {
        completed = true;
        break;
      }
    }
  }

  // ── Final output fallback ──────────────────────────────────────────────────
  // When the last turn produced only tool calls (no text), `finalText` is empty.
  // Fall back to the last non-empty assistant text from the conversation history.
  // This prevents `send_stream_message` from returning `{ response: "" }` when
  // the model consumed all turns making tool calls without producing a summary.
  const effectiveOutput = finalText || (() => {
    // 1. Look for the last assistant message with non-empty content.
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role === 'assistant' && m.content) return m.content;
    }
    // 2. If no assistant message had text but tool calls were made, note it.
    if (totalToolCalls > 0) {
      return `[Sub-agent completed ${totalToolCalls} tool call(s) across ${history.filter((m) => m.role === 'assistant').length} turn(s). No summary text was produced.]`;
    }
    return '';
  })();

  return {
    output: effectiveOutput,
    turns: history.filter((m) => m.role === 'assistant').length,
    toolCallCount: totalToolCalls,
    history: [...history],
    completed,
  };
}
