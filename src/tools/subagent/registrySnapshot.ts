/**
 * Sub-agent registry snapshot builders.
 *
 * Pure functions that transform internal registry state into the public
 * snapshot types consumed by UI layers and persistence.
 *
 * All functions take a `RegistryDeps` object for lazy dependency resolution
 * — no mutable closure state required.
 */

import type { ToolSetContext, PluginStateExtension, PluginUiAdapter } from '@agent-type';
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
 * Collect all ToolSet `onGetSymbolState` results for the given context,
 * keyed by each ToolSet's `symbol` property.
 *
 * Returns a record mapping `symbol → PluginStateExtension & PluginUiAdapter`.
 * ToolSets without a `symbol` or without `onGetSymbolState` are skipped.
 */
export function collectToolSetSymbolState(
  deps: RegistryDeps,
  ctx: ToolSetContext,
  entry: InternalEntry,
): Record<symbol, PluginStateExtension & PluginUiAdapter> {
  const stateCtx = { tools: deps.resolveTools(entry.toolNames) };
  const merged: Record<symbol, PluginStateExtension & PluginUiAdapter> = {};
  for (const ts of deps.resolveToolSets()) {
    if (!ts.symbol) continue;
    const s = ts.onGetSymbolState?.(ctx, stateCtx);
    if (s) merged[ts.symbol] = s;
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
  const ctx = deps.subCtx(entry.name, conv._state.id);
  return Object.assign(
    {},
    {
      ...conv.getState(),
      agentName: entry.name,
      conversationId: conv._state.id,
      ...collectToolSetState(deps, ctx, entry),
    },
    collectToolSetSymbolState(deps, ctx, entry),
  );
}

// ── Entry snapshot ───────────────────────────────────────────────────────────

export function snapshotEntry(
  deps: RegistryDeps,
  entry: InternalEntry,
): SubAgentEntrySnapshot {
  const ctx = deps.subCtx(entry.name, entry.activeConversationId);
  const convList = [...entry.conversations.values()].map((c) =>
    snapshotConversation(deps, c, entry),
  );
  return Object.assign(
    {},
    {
      name: entry.name,
      description: entry.description,
      systemPrompt: entry.systemPrompt,
      toolNames: [...entry.toolNames],
      maxTurns: entry.maxTurns,
      parent: entry.parent,
      createdAt: entry.createdAt,
      activeConversationId: entry.activeConversationId,
      conversations: convList,
      ...collectToolSetState(deps, ctx, entry),
    },
    collectToolSetSymbolState(deps, ctx, entry),
  );
}
