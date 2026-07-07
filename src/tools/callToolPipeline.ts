/**
 * Shared tool-call pipeline.
 *
 * Applies ToolSet lifecycle hooks uniformly across both the main agent and
 * every sub-agent conversation:
 *   1. `onResolveToolArgs`     — resolve variable handles before Zod validation
 *   2. `onPatchToolContext`    — build the execution context
 *   3. `validateToolCall`      — look up tool + Zod-validate arguments
 *   4. `onBeforeToolExecute`   — permission checks / input validation
 *   5. `executeValidatedToolCall` — run the tool implementation
 *   6. `onToolResult`          — intercept / transform the result
 *
 * Use `createToolCallPipeline` to build a bound executor and call it exactly
 * like a plain `(call) => Promise<ToolResult>` at the call site.
 */

import { validateToolCall, executeValidatedToolCall } from "./execute";
import { isAgentError, toErrorMessage } from "./errors";
import type { ToolRegistry } from "./registry";
import type { ToolSet, ToolSetContext } from "@agent-type";
import type {
  ToolCall,
  ToolResult,
  ToolExecutionContext,
  AgentHandler,
} from "@agent-type";

export type ToolCallPipeline = (
  call: ToolCall,
  signal: AbortSignal,
) => Promise<ToolResult>;

export type ToolCallPipelineOptions = {
  /** The tool registry to look up tools from. Accept a lazy getter so that
   * tools registered after pipeline creation (e.g. via `registerToolSet`)
   * are always visible at call time. */
  readonly registry: ToolRegistry | (() => ToolRegistry);
  /**
   * The ToolSets whose hooks run on every tool call.
   *
   * Accepts either a static array or a factory function — use the factory form
   * so that ToolSets registered after pipeline creation (e.g. via
   * `agent.registerToolSet`) are always visible at call time.
   */
  readonly toolSets: readonly ToolSet[] | (() => readonly ToolSet[]);
  readonly ctx: ToolSetContext;
  /**
   * The `AgentHandler` driving the current session.
   * Forwarded into every `ToolExecutionContext` so tools can make meta-calls
   * to the LLM (summarisation, extraction, etc.) without a ToolSet-level
   * closure indirection.
   */
  readonly handler: AgentHandler;
  /**
   * Force-flush any pending persistence write (debounced session snapshots).
   *
   * Forwarded as a first-class field on every `ToolExecutionContext` so a
   * tool can guarantee state lands on disk before it does something
   * destructive — most notably, the upgrade ToolSet calling `restart`
   * which exits the server process.
   *
   * `undefined` when the AgentClient was constructed without an
   * `onSessionsChange` callback (no persistence wired).
   */
  readonly flushPersistence?: () => Promise<void>;
};

export function createToolCallPipeline(
  opts: ToolCallPipelineOptions,
): ToolCallPipeline {
  const { registry, toolSets, ctx, handler, flushPersistence } = opts;

  return async function callTool(
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    // Resolve both the registry and the ToolSet list lazily so that anything
    // registered after pipeline creation (e.g. via agent.registerToolSet) is
    // always visible at the point of the actual call.
    const reg = typeof registry === "function" ? registry() : registry;
    const tsets = typeof toolSets === "function" ? toolSets() : toolSets;

    // ── Stage 1: Resolve arguments ─────────────────────────────────────────
    let args = call.arguments;
    for (const ts of tsets) {
      args = ts.onResolveToolArgs?.(ctx, call.name, args) ?? args;
    }
    const resolvedCall =
      args !== call.arguments ? { ...call, arguments: args } : call;

    // ── Stage 2: Build execution context ────────────────────────────────────
    let ctxPatch: Partial<ToolExecutionContext> = {};
    for (const ts of tsets) {
      const patch = ts.onPatchToolContext?.(ctx, signal);
      if (patch) ctxPatch = { ...ctxPatch, ...patch };
    }

    const baseContext: ToolExecutionContext = {
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      conversationId: ctx.conversationId,
      signal,
      handler,
      flushPersistence,

      ...ctxPatch,
    };

    // ── Stage 3: Validate (lookup tool + Zod-parse args) ───────────────────
    const validated = await validateToolCall(reg, resolvedCall);
    const tool = validated.tool;

    // ── Stage 4: onBeforeToolExecute hooks ──────────────────────────────────
    for (const ts of tsets) {
      const intercept = await ts.onBeforeToolExecute?.(
        ctx,
        call.name,
        tool,
        validated.parsedArgs,
        baseContext,
      );
      if (intercept && !intercept.allow) {
        return intercept.result;
      }
    }

    // ── Stage 5: Execute the tool ───────────────────────────────────────────
    let result = await executeValidatedToolCall(validated, baseContext);

    // ── Stage 6: Intercept / transform the result ──────────────────────────
    for (const ts of tsets) {
      result = ts.onToolResult?.(ctx, call.name, result) ?? result;
    }
    return result;
  };
}

/**
 * Wraps a ToolCallPipeline to catch any thrown AgentError (or unknown error)
 * and convert it into a structured ToolResult so the agent loop never sees
 * a thrown rejection from a pipeline call.
 *
 * The result payload is a JSON object `{ _error, code, toolName, message }`
 * — the LLM receives structured context about what went wrong.
 */
export function withErrorBoundary(
  pipeline: ToolCallPipeline,
): ToolCallPipeline {
  return async function callToolSafe(call, signal) {
    try {
      return await pipeline(call, signal);
    } catch (err) {
      const code = isAgentError(err) ? err.code : "TOOL_EXECUTION";
      const toolName = isAgentError(err)
        ? (err.toolName ?? call.name)
        : call.name;
      const message = toErrorMessage(err);
      return {
        toolCallId: call.id,
        name: call.name,
        result: JSON.stringify({ _error: true, code, toolName, message }),
      };
    }
  };
}
