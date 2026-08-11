import type { Tool, ToolSet, ToolSetContext } from "@agent-type";
import type { SessionEntryData } from "@agent-type";
import type { SessionEntryExtension } from '@agent-type';
export { resolveToolSetTools } from '@agent-type';

// Re-export shared constants & helpers (now defined in @agent-type)
export { MAIN_CONVERSATION_ID, ctxKey } from '@agent-type';

// ── AgentClientLike types ──────────────────────────────────────────────────
// AgentQueryFns and AgentClientLike are now defined in @agent-type/toolset.ts

// ── ToolSet invocation context ────────────────────────────────────────────────

// MAIN_CONVERSATION_ID and ctxKey are now defined in @agent-type/toolset.ts
// and re-exported above.

// ToolSetStateContext, ToolContextPatch, SystemPromptContext, CompactionNotice,
// CompactionResult, AgentRunOutcome, ToolSetState are now defined in @agent-type/toolset.ts

// ToolSet type is now defined in @agent-type/toolset.ts

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Internal brand check ─────────────────────────────────────────────────────

/**
 * Check whether a ToolSet carries a specific internal brand.
 *
 * The brand is an opaque symbol created by the UI layer and injected into all
 * built-in app ToolSets during app activation.  `buildSystemPrompt` uses
 * this check to gate access to `suppressToolSetPrompt` – only branded ToolSets
 * (internal/built-in) may suppress other ToolSets' prompt fragments.
 *
 * External/third-party ToolSets never have the brand because they cannot
 * recreate the symbol (it's created once per agent-client instance and never
 * exposed outside the project).
 *
 * @param ts    The ToolSet to check.
 * @param brand The internal brand symbol (from the agent client config).
 * @returns     `true` when the ToolSet carries the brand.
 */
export function isBranded(ts: ToolSet, brand: symbol): boolean {
  return (ts as Record<symbol, unknown>)[brand] === true;
}
