/**
 * extensions/tool-state/agent/toolSet.ts — Tool enable/disable ToolSet
 *
 * Migrated from src/tools/toolStateToolSet/index.ts.
 *
 * Key changes:
 * - Uses `onGetSymbolState` instead of `onGetState` (symbol-isolated)
 * - Declares `symbol: TOOL_STATE_SYMBOL`
 * - UI slots: panel (for ToolsPanel in sandboxed iframe)
 */

import type { Tool, ToolResult, ToolExecutionContext, SystemPromptContext } from '@agent-type';
import type { ToolSet, ToolSetContext, SessionEntryData } from '@agent-type';
import { ctxKey, resolveToolSetTools } from '@agent-type';
import type { ToolStateEntry, ToolStateSymbolState } from './types';
import type { PluginSlotDeclaration } from '@agent-type';

// ── Brand symbol ──────────────────────────────────────────────────────────────

export const TOOL_STATE_SYMBOL = Symbol('tool-state');
const TOOL_STATE_TOOLSET_BRAND = Symbol.for('sdk.ToolStateToolSet');

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToolStateControl = {
  toggleTool(ctx: ToolSetContext, name: string): void;
  disableNames(ctx: ToolSetContext, names: ReadonlySet<string>): void;
  enableNames(ctx: ToolSetContext, names: ReadonlySet<string>): void;
  disableGroup(ctx: ToolSetContext, group: string): void;
  enableGroup(ctx: ToolSetContext, group: string): void;
  getDisabledNames(ctx: ToolSetContext): ReadonlySet<string>;
};

export type ToolStateToolSet = ToolSet & ToolStateControl & {
  readonly [TOOL_STATE_TOOLSET_BRAND]: true;
};

export function isToolStateToolSet(ts: ToolSet): ts is ToolStateToolSet {
  return (ts as ToolStateToolSet)[TOOL_STATE_TOOLSET_BRAND] === true;
}

export function findToolStateToolSet(toolSets: readonly ToolSet[]): ToolStateToolSet | undefined {
  return toolSets.find(isToolStateToolSet);
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createToolStateToolSet(): ToolStateToolSet {
  const disabledMap = new Map<string, Set<string>>();
  const toolCache = new Map<string, readonly Tool[]>();
  const subsMap = new Map<string, Set<() => void>>();

  function getDisabled(key: string): Set<string> {
    let s = disabledMap.get(key);
    if (!s) { s = new Set(); disabledMap.set(key, s); }
    return s;
  }

  function notifyScope(key: string): void {
    subsMap.get(key)?.forEach((fn) => fn());
  }

  function onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
    if (entryData.toolStates) {
      const toDisable = Object.entries(entryData.toolStates)
        .filter(([, enabled]) => !enabled)
        .map(([name]) => name);
      if (toDisable.length > 0) {
        const disabled = getDisabled(ctxKey(ctx));
        for (const name of toDisable) disabled.add(name);
      }
    }
  }

  function onRemoveSession(ctx: ToolSetContext): void {
    const key = ctxKey(ctx);
    disabledMap.delete(key);
    toolCache.delete(key);
    subsMap.delete(key);
  }

  function onGetSymbolState(ctx: ToolSetContext, stateCtx?: { readonly tools: readonly Tool[] }): ToolStateSymbolState {
    const key = ctxKey(ctx);
    const tools = stateCtx?.tools ?? toolCache.get(key) ?? [];
    const disabled = disabledMap.get(key);
    const toolStates: ToolStateEntry[] = tools.map((t) => ({
      name: t.name,
      description: typeof t.description === 'function' ? t.description() : t.description,
      enabled: !disabled?.has(t.name),
      group: t.group,
    }));
    return {
      type: 'toolState',
      toolStates,
      toggleTool: (name: string) => toggleTool(ctx, name),
      slots: [
        {
          type: 'panel' as const,
          label: 'Tools',
          showTab: () => true,
          shouldRender: () => true,
        },
      ] satisfies readonly PluginSlotDeclaration[],
    };
  }

  function onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
    const key = ctxKey(ctx);
    let subs = subsMap.get(key);
    if (!subs) { subs = new Set(); subsMap.set(key, subs); }
    subs.add(fn);
    return () => subs!.delete(fn);
  }

  function onBuildSnapshot(ctx: ToolSetContext): { toolStates?: Record<string, boolean> } {
    const key = ctxKey(ctx);
    const tools = toolCache.get(key) ?? [];
    const disabled = disabledMap.get(key);
    if (!tools.length && !disabled?.size) return {};
    const toolStates: Record<string, boolean> = {};
    for (const t of tools) {
      toolStates[t.name] = !disabled?.has(t.name);
    }
    if (disabled) {
      for (const name of disabled) {
        if (!(name in toolStates)) toolStates[name] = false;
      }
    }
    return { toolStates };
  }

  function onFilterTools(ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
    const key = ctxKey(ctx);
    toolCache.set(key, tools);
    const disabled = disabledMap.get(key);
    if (!disabled || disabled.size === 0) return tools;
    return tools.filter((t) => !disabled.has(t.name));
  }

  async function onBeforeToolExecute(
    ctx: ToolSetContext,
    toolName: string,
    _tool: Tool,
    _args: Record<string, unknown>,
    _execCtx: ToolExecutionContext,
  ): Promise<{ allow: true } | { allow: false; result: ToolResult } | void> {
    const disabled = disabledMap.get(ctxKey(ctx));
    if (disabled?.has(toolName)) {
      const result: ToolResult = {
        toolCallId: '',
        name: toolName,
        result: { ok: false, error: `Tool "${toolName}" is currently disabled and cannot be executed.` },
      };
      return { allow: false, result };
    }
    return { allow: true };
  }

  function onGetSystemPrompt(
    ctx: ToolSetContext,
    promptCtx: SystemPromptContext,
    toolSets: readonly ToolSet[],
  ): undefined {
    const disabled = disabledMap.get(ctxKey(ctx));
    if (!disabled || disabled.size === 0) return;

    for (const ts of toolSets) {
      if (ts === toolStateSelf) continue;
      const tools = resolveToolSetTools(ts);
      if (tools.length === 0) continue;
      const allDisabled = tools.every((t) => disabled.has(t.name));
      if (allDisabled) promptCtx.suppressToolSetPrompt(ts.name);
    }
    return;
  }

  function toggleTool(ctx: ToolSetContext, name: string): void {
    const key = ctxKey(ctx);
    const disabled = getDisabled(key);
    if (disabled.has(name)) disabled.delete(name);
    else disabled.add(name);
    notifyScope(key);
  }

  function disableNames(ctx: ToolSetContext, names: ReadonlySet<string>): void {
    const key = ctxKey(ctx);
    const disabled = getDisabled(key);
    for (const n of names) disabled.add(n);
    notifyScope(key);
  }

  function enableNames(ctx: ToolSetContext, names: ReadonlySet<string>): void {
    const key = ctxKey(ctx);
    const disabled = disabledMap.get(key);
    if (!disabled) return;
    for (const n of names) disabled.delete(n);
    notifyScope(key);
  }

  function disableGroup(ctx: ToolSetContext, group: string): void {
    const key = ctxKey(ctx);
    const cached = toolCache.get(key);
    if (!cached) return;
    const names = cached.filter((t) => t.group === group).map((t) => t.name);
    if (names.length === 0) return;
    const disabled = getDisabled(key);
    for (const n of names) disabled.add(n);
    notifyScope(key);
  }

  function enableGroup(ctx: ToolSetContext, group: string): void {
    const key = ctxKey(ctx);
    const cached = toolCache.get(key);
    if (!cached) return;
    const names = new Set(cached.filter((t) => t.group === group).map((t) => t.name));
    if (names.size === 0) return;
    const disabled = disabledMap.get(key);
    if (!disabled) return;
    for (const n of names) disabled.delete(n);
    notifyScope(key);
  }

  function getDisabledNames(ctx: ToolSetContext): ReadonlySet<string> {
    return disabledMap.get(ctxKey(ctx)) ?? new Set<string>();
  }

  const toolStateSelf: ToolStateToolSet = {
    name: 'ToolState',
    symbol: TOOL_STATE_SYMBOL,
    tools: [],
    [TOOL_STATE_TOOLSET_BRAND]: true as const,

    onInitSession,
    onRemoveSession,
    onGetSymbolState,
    onSubscribe,
    onBuildSnapshot,
    onFilterTools,
    onBeforeToolExecute,
    onGetSystemPrompt,

    toggleTool,
    disableNames,
    enableNames,
    disableGroup,
    enableGroup,
    getDisabledNames,
  };

  return toolStateSelf;
}
