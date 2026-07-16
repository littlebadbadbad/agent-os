/**
 * Sub-agent registry snapshot builders.
 *
 * Delegates ToolSet state collection to {@link ToolSetScope} — all real logic
 * lives in `sharedStateCollector.ts` and is routed through the scope.
 */

import type { ToolSetContext, ToolSetStateContext, PluginStateExtension, PluginUiAdapter } from '@agent-type';
import type { ToolSetScope } from '@agent-sdk/tools/toolSetScope';
import type {
  SubAgentConversationState,
  SubAgentEntrySnapshot,
} from './registryTypes';
import type { ConversationHandle } from './registryConversation';
import type { InternalEntry } from './registryInternal';
import type { Tool } from '@agent-type';

// ── ToolSet state collection ─────────────────────────────────────────────────

function buildStateCtx(resolveTools: (names: readonly string[]) => Tool[], toolNames: readonly string[]): ToolSetStateContext {
  return { tools: resolveTools(toolNames) };
}

export function collectToolSetState(
  resolveTools: (names: readonly string[]) => Tool[],
  toolNames: readonly string[],
  scope: ToolSetScope,
  ctx: ToolSetContext,
): Record<string, unknown> {
  return (scope.collectState(ctx, buildStateCtx(resolveTools, toolNames)) as Record<string, unknown>);
}

export function collectToolSetSymbolState(
  resolveTools: (names: readonly string[]) => Tool[],
  toolNames: readonly string[],
  scope: ToolSetScope,
  ctx: ToolSetContext,
): Record<symbol, PluginStateExtension & PluginUiAdapter> {
  const full = scope.collectState(ctx, buildStateCtx(resolveTools, toolNames));
  const keys = Object.getOwnPropertySymbols(full);
  const symbol: Record<symbol, PluginStateExtension & PluginUiAdapter> = {};
  for (let i = 0; i < keys.length; i++) {
    symbol[keys[i]] = full[keys[i]] as PluginStateExtension & PluginUiAdapter;
  }
  return symbol;
}

// ── Conversation snapshot ────────────────────────────────────────────────────

export function snapshotConversation(
  subCtx: (agentName: string, conversationId: string) => ToolSetContext,
  resolveTools: (names: readonly string[]) => Tool[],
  scope: ToolSetScope,
  conv: ConversationHandle,
  entry: InternalEntry,
): SubAgentConversationState {
  const ctx = subCtx(entry.name, conv._state.id);
  return Object.assign(
    {},
    {
      ...conv.getState(),
      agentName: entry.name,
      conversationId: conv._state.id,
      ...collectToolSetState(resolveTools, entry.toolNames, scope, ctx),
    },
    collectToolSetSymbolState(resolveTools, entry.toolNames, scope, ctx),
  );
}

// ── Entry snapshot ───────────────────────────────────────────────────────────

export function snapshotEntry(
  subCtx: (agentName: string, conversationId: string) => ToolSetContext,
  resolveTools: (names: readonly string[]) => Tool[],
  scope: ToolSetScope,
  entry: InternalEntry,
): SubAgentEntrySnapshot {
  const ctx = subCtx(entry.name, entry.activeConversationId);
  const convList = [...entry.conversations.values()].map((c) =>
    snapshotConversation(subCtx, resolveTools, scope, c, entry),
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
      ...collectToolSetState(resolveTools, entry.toolNames, scope, ctx),
    },
    collectToolSetSymbolState(resolveTools, entry.toolNames, scope, ctx),
  );
}
