import type { ToolCall, ToolResult, ToolExecutionContext, Tool, Attachment } from '@agent-type';
import type { ToolRegistry } from './registry';
import { getRegisteredTool } from './registry';
import { toolNotFoundError, toolValidationError } from './errors';

/**
 * Hard character limit for any single tool result.
 *
 * Results that exceed this threshold are truncated and annotated so the agent
 * knows data was dropped and can decide how to retrieve the rest.  The limit
 * is intentionally generous (~10 k tokens) — tool-level pagination (e.g.
 * read_file startLine/endLine, terminal_read maxChars) should fire first.
 * This is a last-resort safety net for tools that do not self-limit.
 */
const MAX_RESULT_CHARS = 40_000;

/**
 * Truncate an oversized tool result and annotate it so the agent is aware.
 * - Strings are sliced and suffixed with an omission notice.
 * - Objects are JSON-serialised then sliced (the JSON may become invalid after
 *   truncation — the agent will see the notice and know to act accordingly).
 * - Other primitives are returned unchanged.
 */
function clampToolResult(result: unknown): unknown {
  if (typeof result === 'string') {
    if (result.length <= MAX_RESULT_CHARS) return result;
    const omitted = result.length - MAX_RESULT_CHARS;
    return (
      result.slice(0, MAX_RESULT_CHARS) +
      `\n…[${omitted.toLocaleString()} chars omitted — result exceeded the ${MAX_RESULT_CHARS.toLocaleString()}-char context limit. Use pagination or a narrower query to retrieve the rest.]`
    );
  }
  if (typeof result === 'object' && result !== null) {
    const json = JSON.stringify(result);
    if (json.length <= MAX_RESULT_CHARS) return result;
    const omitted = json.length - MAX_RESULT_CHARS;
    // Return a string so the agent sees both the partial data and the notice.
    return (
      json.slice(0, MAX_RESULT_CHARS) +
      `…[${omitted.toLocaleString()} chars omitted — result exceeded the ${MAX_RESULT_CHARS.toLocaleString()}-char context limit. Use pagination or a narrower query to retrieve the rest.]`
    );
  }
  return result;
}

/** No-op fallback context used when no session layer is present (e.g. direct test calls). */
export const NOOP_CONTEXT: ToolExecutionContext = {
  signal: new AbortController().signal,
  sessionId: '',
  agentName: 'main',
  conversationId: '',
};

// ── Validated result type ─────────────────────────────────────────────────────

/** A tool call that has been resolved to a tool instance and validated. */
export type ValidatedToolCall = {
  readonly tool: Tool;
  readonly call: ToolCall;
  readonly parsedArgs: Record<string, unknown>;
};

// ── Phase 1: Lookup + validate ────────────────────────────────────────────────

/**
 * Look up a tool by name and validate its arguments against the tool's Zod schema.
 *
 * This is the first half of `executeToolCall`, split out so the pipeline can
 * interleave lifecycle hooks between validation and execution.
 *
 * @returns The resolved tool and validated arguments.
 * @throws {Error} If the tool is not registered or arguments are invalid.
 */
export async function validateToolCall(
  registry: ToolRegistry,
  call: ToolCall,
): Promise<ValidatedToolCall> {
  const tool = getRegisteredTool(registry, call.name);

  if (!tool) {
    throw toolNotFoundError(call.name);
  }

  const schema = typeof tool.parameters === 'function' ? tool.parameters() : tool.parameters;
  const parsed = schema.safeParse(call.arguments);

  if (!parsed.success) {
    throw toolValidationError(call.name, `Invalid arguments for tool "${call.name}": ${parsed.error.message}`);
  }

  return { tool, call, parsedArgs: parsed.data as Record<string, unknown> };
}

// ── Phase 2: Execute ──────────────────────────────────────────────────────────

/**
 * Execute a pre-validated tool call.
 *
 * Runs the tool's `execute` function with the validated args, then post-processes
 * the result (attachment extraction, clamping).
 *
 * This is the second half of `executeToolCall`, split out so the pipeline can
 * interleave lifecycle hooks between validation and execution.
 */
export async function executeValidatedToolCall(
  validated: ValidatedToolCall,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { tool, call } = validated;
  const raw = await tool.execute(validated.parsedArgs as never, context);

  // Extract image/file attachments from the tool result side-channel.
  let toolResult: unknown = raw;
  let attachments: readonly Attachment[] | undefined;
  if (raw !== null && typeof raw === 'object' && '__toolAttachments__' in (raw as object)) {
    const { __toolAttachments__, ...rest } = raw as Record<string, unknown>;
    attachments = __toolAttachments__ as readonly Attachment[];
    toolResult = rest;
  }

  return {
    toolCallId: call.id,
    name: call.name,
    result: clampToolResult(toolResult),
    ...(attachments ? { attachments } : {}),
  };
}

// ── Combined convenience ──────────────────────────────────────────────────────

/**
 * Execute a tool call against a registry (full pipeline).
 *
 * Convenience wrapper around `validateToolCall` + `executeValidatedToolCall`.
 * Use this for direct / test call sites that don't need lifecycle hooks.
 *
 * @throws {Error} If the tool is not registered or arguments are invalid.
 */
export async function executeToolCall(
  registry: ToolRegistry,
  call: ToolCall,
  context: ToolExecutionContext = NOOP_CONTEXT,
): Promise<ToolResult> {
  const validated = await validateToolCall(registry, call);
  return executeValidatedToolCall(validated, context);
}
