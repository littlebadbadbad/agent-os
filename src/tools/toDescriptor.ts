import { z } from 'zod';
import type {
  Tool,
  ToolDescriptor,
  OpenAIToolParam,
  AnthropicToolParam,
  GeminiFunctionDeclaration,
  ToolExecutionContext,
} from '@agent-type';

// ── Core conversion ───────────────────────────────────────────────────────────

/**
 * Resolve a field that may be a plain value or a zero-arg factory function.
 */
function resolve<T>(v: T | (() => T)): T {
  return typeof v === 'function' ? (v as () => T)() : v;
}

/**
 * Resolve a tool's description for a specific invocation.
 *
 * Priority order:
 * 1. `tool.getDescription(params, context)` — dynamic, call-site-specific.
 * 2. `tool.description` — static string or zero-arg factory.
 *
 * Use this in the execution pipeline when you have the tool's input params
 * and want the most context-specific description (e.g. for UI rendering of
 * the tool call).
 *
 * @returns The resolved description string (never undefined).
 */
export async function resolveToolDescription(
  tool: Tool,
  params: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  if (tool.getDescription) {
    // Call the dynamic description function with the typed params.
    // The Tool's TSchema is unknown at this call site, so we cast through
    // `unknown` — the tool author is responsible for ensuring the params
    // shape matches what getDescription expects.
    return await tool.getDescription(params as never, context);
  }
  return resolve(tool.description);
}

export function toDescriptor(tool: Tool): ToolDescriptor {
  const description = resolve(tool.description);

  // If a raw JSON Schema override is supplied (e.g. for dynamically created tools
  // whose schema is provided at runtime rather than derived from a Zod definition),
  // use it directly so the AI sees the exact schema the agent intended.
  if (tool.rawParametersSchema) {
    return {
      name: tool.name,
      description,
      parameters: resolve(tool.rawParametersSchema),
    };
  }

  const raw = z.toJSONSchema(resolve(tool.parameters), {
    reused: 'inline', // Inline all $defs — AI APIs don't resolve $ref
  }) as Record<string, unknown>;

  // Strip the outer $schema annotation — providers don't expect it
  const { $schema: _ignored, ...parameters } = raw;

  return {
    name: tool.name,
    description,
    parameters,
  };
}

/** Convert an array of `Tool`s to vendor-agnostic `ToolDescriptor`s. */
export const toDescriptors = (tools: readonly Tool[]): ToolDescriptor[] =>
  tools.map(toDescriptor);

// ── Vendor-specific formatters ────────────────────────────────────────────────

/**
 * Format a descriptor for the **OpenAI** Chat Completions / Assistants API.
 *
 * Usage:
 * ```ts
 * const response = await openai.chat.completions.create({
 *   tools: context.toOpenAITools(),
 * });
 * ```
 */
export const toOpenAITool = (descriptor: ToolDescriptor): OpenAIToolParam => ({
  type: 'function',
  function: {
    name: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.parameters,
  },
});

/**
 * Format a descriptor for the **Anthropic** Messages API.
 *
 * Usage:
 * ```ts
 * const message = await anthropic.messages.create({
 *   tools: context.toAnthropicTools(),
 * });
 * ```
 */
export const toAnthropicTool = (descriptor: ToolDescriptor): AnthropicToolParam => ({
  name: descriptor.name,
  description: descriptor.description,
  input_schema: descriptor.parameters,
});

/**
 * Format a descriptor for the **Google Gemini** API's `functionDeclarations`.
 *
 * Usage:
 * ```ts
 * const result = await model.generateContent({
 *   tools: [{ functionDeclarations: context.toGeminiTools() }],
 * });
 * ```
 */
export const toGeminiTool = (descriptor: ToolDescriptor): GeminiFunctionDeclaration => ({
  name: descriptor.name,
  description: descriptor.description,
  parameters: descriptor.parameters,
});
