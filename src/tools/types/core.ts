import type { z, ZodTypeAny } from 'zod';
import type { ToolField } from '@agent-type';

// ── Field resolution helpers ──────────────────────────────────────────────────

// All type definitions (Tool, ToolDescriptor, ToolCall, ToolResult,
// ToolExecutionContext, ToolExecutionContextExtension, ToolField)
// are now defined in @agent-type/core.ts

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
