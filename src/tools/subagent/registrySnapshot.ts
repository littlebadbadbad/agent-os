/**
 * Sub-agent registry snapshot builders.
 *
 * Pure functions that transform internal registry state into the public
 * snapshot types consumed by UI layers and persistence.
 *
 * All functions take a `RegistryDeps` object for lazy dependency resolution
 * — no mutable closure state required.
 */

import type { ToolSetContext } from '@agent-type';
import type {
  SubAgentConversationState,
  SubAgentEntrySnapshot,
} from './registryTypes';
import type { ConversationHandle } from './registryConversation';
import type { InternalEntry, RegistryDeps } from './registryInternal';

// ── ToolSet state collection ─────────────────────────────────────────────────

/**
 * Merge all ToolSet `onGetState` results for the given context into a single
 * record — no field names from any specific ToolSet appear here.
 */
export function collectToolSetState(
  deps: RegistryDeps,
  ctx: ToolSetContext,
  entry: InternalEntry,
): Record<string, unknown> {
  const stateCtx = { tools: deps.resolveTools(entry.toolNames) };
  const merged: Record<string, unknown> = {};
  for (const ts of deps.resolveToolSets()) {
    const s = ts.onGetState?.(ctx, stateCtx);
    if (s) Object.assign(merged, s);
  }
  return merged;
}

/**
 * Merge all ToolSet `onBuildSnapshot` results for the given context.
 * Used by `getSnapshot()` so persistence receives the ToolSet's declared
 * snapshot fields rather than the transient runtime state.
 */
export function collectToolSetSnapshot(
  deps: RegistryDeps,
  ctx: ToolSetContext,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const ts of deps.resolveToolSets()) {
    const s = ts.onBuildSnapshot?.(ctx);
    if (s) Object.assign(merged, s);
  }
  return merged;
}

// ── Conversation snapshot ────────────────────────────────────────────────────

export function snapshotConversation(
  deps: RegistryDeps,
  conv: ConversationHandle,
  entry: InternalEntry,
): SubAgentConversationState {
  return {
    ...conv.getState(),
    ...collectToolSetState(deps, deps.subCtx(entry.name, conv._state.id), entry),
  } as SubAgentConversationState;
}

// ── Entry snapshot ───────────────────────────────────────────────────────────

export function snapshotEntry(
  deps: RegistryDeps,
  entry: InternalEntry,
): SubAgentEntrySnapshot {
  const convList = [...entry.conversations.values()].map((c) =>
    snapshotConversation(deps, c, entry),
  );
  return {
    name: entry.name,
    description: entry.description,
    systemPrompt: entry.systemPrompt,
    toolNames: [...entry.toolNames],
    maxTurns: entry.maxTurns,
    parent: entry.parent,
    createdAt: entry.createdAt,
    activeConversationId: entry.activeConversationId,
    conversations: convList,
    ...collectToolSetState(deps, deps.subCtx(entry.name, entry.activeConversationId), entry),
  } as SubAgentEntrySnapshot;
}
