/**
 * agent-type/defineTool.ts — Type-safe tool definition helpers
 *
 * MOVED FROM src/tools/defineTool.ts
 *
 * Provides `defineTool` (identity + freeze, no defaults) and `buildTool`
 * (fills in safe defaults + freeze) for constructing fully-typed Tool objects.
 *
 * These are runtime functions (not just types), placed here so both the SDK
 * and extensions can import them from `@agent-type/defineTool` without
 * depending on `@agent-sdk`.
 */

import type { z, ZodTypeAny } from 'zod';
import type { Tool, ToolField, ToolExecutionContext } from './core';
import { ToolSet } from './toolset';

// ── Defaults for optional metadata fields ─────────────────────────────────────

/** Safe defaults applied by `buildTool` when the definition omits a field. */
export const TOOL_DEFAULTS = {
  isReadOnly: false as boolean,
  isDestructive: false as boolean,
  isConcurrencySafe: false as boolean,
  interruptBehavior: 'block' as const,
};

/**
 * Keys that `buildTool` auto-fills.
 * `ToolDef` marks these as optional so callers can omit them.
 */
type DefaultableKeys = 'isReadOnly' | 'isDestructive' | 'isConcurrencySafe' | 'interruptBehavior';

/**
 * Tool definition accepted by `buildTool`.
 *
 * Same shape as `Tool` but with the defaultable metadata fields optional.
 * `buildTool` fills them in so callers always see a complete `Tool`.
 */
export type ToolDef<
  TName extends string = string,
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> = Omit<Tool<TName, TSchema, TResult>, DefaultableKeys> &
  Partial<Pick<Tool<TName, TSchema, TResult>, DefaultableKeys>>;

/**
 * Identity helper that constructs a fully type-safe `Tool` with inference.
 *
 * Without this helper TypeScript cannot infer `TSchema` from the object
 * literal because generics on type aliases are not inferred at construction
 * sites — only function calls trigger generic inference.
 *
 * The returned object is frozen so the definition is effectively a constant.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { defineTool } from '@agent-type/defineTool';
 *
 * const getWeather = defineTool({
 *   name: 'get_weather',
 *   description: 'Returns the current weather for a city.',
 *   parameters: z.object({
 *     city: z.string().describe('City name, e.g. "London"'),
 *     unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
 *   }),
 *   execute: async ({ city, unit }) => {
 *     const data = await fetchWeatherApi(city, unit);
 *     return data;
 *   },
 * });
 * ```
 */
export function defineTool<
  const TName extends string,
  TSchema extends ZodTypeAny,
  TResult = unknown,
>(tool: Tool<TName, TSchema, TResult>): Tool<TName, TSchema, TResult> {
  return Object.freeze(tool) as Tool<TName, TSchema, TResult>;
}

/**
 * Build a complete `Tool` from a partial definition, filling in safe defaults
 * for the optional metadata fields.
 *
 * `defineTool` is a pure identity function (strict typing, no defaults).
 * `buildTool` is the convenience version — callers can omit `isReadOnly`,
 * `isDestructive`, `isConcurrencySafe`, and `interruptBehavior`, and they
 * will be set to safe defaults (`false` / `'block'`).
 *
 * @example
 * ```ts
 * const readFoo = buildTool({
 *   name: 'read_foo',
 *   description: 'Read a foo.',
 *   parameters: z.object({ path: z.string() }),
 *   execute: async ({ path }) => readFile(path),
 *   // isReadOnly defaults to false — but semantically this IS read-only
 * });
 * ```
 */
export function buildTool<
  const TName extends string,
  TSchema extends ZodTypeAny,
  TResult = unknown,
>(def: ToolDef<TName, TSchema, TResult>): Tool<TName, TSchema, TResult> {
  const defaults: Pick<Tool<TName, TSchema, TResult>, DefaultableKeys> = {
    isReadOnly: TOOL_DEFAULTS.isReadOnly,
    isDestructive: TOOL_DEFAULTS.isDestructive,
    isConcurrencySafe: TOOL_DEFAULTS.isConcurrencySafe,
    interruptBehavior: TOOL_DEFAULTS.interruptBehavior,
  };

  return Object.freeze({ ...defaults, ...def }) as unknown as Tool<TName, TSchema, TResult>;
}


/**
 * Resolve the `tools` field of a ToolSet to a concrete readonly array.
 * Handles both the static-array and factory-function forms.
 * Returns an empty array when `tools` is null or undefined.
 */
export function resolveToolSetTools(ts: ToolSet): readonly Tool[] {
  const tools = typeof ts.tools === "function" ? ts.tools() : ts.tools;
  return tools ?? [];
}

/**
 * Resolve a `ToolField` to a concrete value.
 *
 * If the field is a function (predicate form), call it with the parsed params.
 * If the field is a plain value, return it directly.
 * If the field is `undefined`, return `fallback`.
 */
export function resolveToolField<T, TSchema extends ZodTypeAny>(
  field: ToolField<T, TSchema> | undefined,
  params: z.infer<TSchema>,
  fallback: T,
): T {
  if (field === undefined) return fallback;
  return typeof field === 'function' ? (field as (p: z.infer<TSchema>) => T)(params) : field;
}

/**
 * Resolve a value-or-factory to a concrete value.
 */
export function resolveFactory<T>(v: T | (() => T)): T {
  return typeof v === 'function' ? (v as () => T)() : v;
}
