import type { Tool, ToolSet, ToolSetContext } from "@agent-type";
import type { SessionEntryData } from "@agent-type";
import type { SessionEntryExtension } from '@agent-type';
export { resolveToolSetTools } from '@agent-type';

// ── AgentClientLike types ──────────────────────────────────────────────────
// AgentQueryFns and AgentClientLike are now defined in @agent-type/toolset.ts

// ── ToolSet invocation context ────────────────────────────────────────────────

/**
 * Sentinel `conversationId` used for the main agent (non-sub-agent) context.
 * Sub-agents always carry their real conversation ID.
 */
export const MAIN_CONVERSATION_ID = "main" as const;

// ToolSetContext type is now defined in @agent-type/toolset.ts

/**
 * Derive the canonical Map key for a `ToolSetContext`.
 *
 * - Main agent:  `sessionId`
 * - Sub-agent:   `"${sessionId}:${agentName}"`
 *
 * This matches the key format used before `ToolSetContext` was introduced,
 * so persisted data (e.g. toolStates, todos) remains compatible.
 */
export function toolSetContextKey(ctx: ToolSetContext): string {
  return ctx.conversationId === MAIN_CONVERSATION_ID
    ? ctx.sessionId
    : `${ctx.sessionId}:${ctx.agentName}`;
}

// ToolSetStateContext, ToolContextPatch, SystemPromptContext, CompactionNotice,
// CompactionResult, AgentRunOutcome, ToolSetState are now defined in @agent-type/toolset.ts

// ToolSet type is now defined in @agent-type/toolset.ts

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── ToolStateToolSet brand ───────────────────────────────────────────────────

/**
 * Brand symbol that identifies the ToolStateToolSet.
 *
 * Defined in the base layer so that `buildSystemPrompt` can check it
 * without importing from the ToolStateToolSet module — preserving the
 * module dependency direction (toolset → base, never base → toolset).
 *
 * The base layer uses this brand to gate access to
 * `suppressToolSetPrompt`: only ToolSets carrying this brand (set to
 * `true`) receive a functional callback.  All other ToolSets get a
 * no-op, preventing arbitrary ToolSets from suppressing each other's
 * system-prompt fragments.
 */
export const TOOL_STATE_TOOLSET_BRAND = Symbol.for('sdk.ToolStateToolSet');

/**
 * Check whether a ToolSet is authorised to call `suppressToolSetPrompt`.
 *
 * Only ToolSets that carry the `TOOL_STATE_TOOLSET_BRAND` (set to `true`)
 * are allowed to suppress other ToolSets' system-prompt fragments.
 * Currently only `ToolStateToolSet` satisfies this check.
 */
export function canSuppressPrompt(ts: ToolSet): boolean {
  return (ts as Record<symbol, unknown>)[TOOL_STATE_TOOLSET_BRAND] === true;
}
