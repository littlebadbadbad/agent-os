/**
 * Tool State ToolSet — per-scope tool enable/disable + semantic tool discovery.
 *
 * Merged from the former tool-state and tool-search plugins.
 *
 * Responsibilities:
 *  1. Track and persist per-scope tool enabled/disabled state.
 *  2. Filter disabled tools from the visible tool list.
 *  3. When visible tool count exceeds TOOL_SEARCH_THRESHOLD, defer non-core
 *     tools behind `tool_search`.
 *  4. Provide `tool_search` for keyword-based deferred-tool discovery.
 *  5. Suppress system-prompt fragments of fully-disabled ToolSets.
 */

import type { Tool, ToolResult, ToolExecutionContext, SystemPromptContext } from '@agent-type';
import type { ToolSet, ToolSetContext, SessionEntryData, AgentQueryFns } from '@agent-type';
import { ctxKey, resolveToolSetTools } from '@agent-type';
import type { ToolStateEntry, ToolStateSymbolState } from './types';
import { createToolSearchTool, TOOL_SEARCH_THRESHOLD } from './tools';
import { TOOL_SEARCH_GUIDANCE } from './prompt';

// ── Public symbol ─────────────────────────────────────────────────────────────

export const TOOL_STATE_SYMBOL = Symbol('tool-state');

// ── Internal helpers ──────────────────────────────────────────────────────────

function ensureMap<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = factory();
    map.set(key, value);
  }
  return value;
}

function notifySubscribers(subsMap: Map<string, Set<() => void>>, key: string): void {
  subsMap.get(key)?.forEach((fn) => fn());
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createToolStateToolSet(): ToolSet<ToolStateSymbolState> & {
  toggleTool(ctx: ToolSetContext, name: string): void;
} {
  const disabledMap = new Map<string, Set<string>>();
  const toolCache = new Map<string, readonly Tool[]>();
  const subsMap = new Map<string, Set<() => void>>();
  let agent: AgentQueryFns | null = null;

  // ── Core-names resolution ──────────────────────────────────────────────────

  function buildCoreNames(): Set<string> {
    const names = new Set<string>(['tool_search']);
    if (agent) {
      for (const ts of agent.getRegisteredToolSets()) {
        if (ts.coreTools) {
          for (const name of ts.coreTools) names.add(name);
        }
      }
    }
    return names;
  }

  // ── Disabled-name lookup (per key, used by tool_search) ────────────────────

  function getDisabledForScope(key: string): ReadonlySet<string> {
    return disabledMap.get(key) ?? new Set<string>();
  }

  // ── tool_search (lazy: resolves tools+core+disabled fresh on each call) ────

  const toolSearchTool = createToolSearchTool(
    () => agent?.getTools() ?? [],
    () => buildCoreNames(),
    (key: string) => getDisabledForScope(key),
  );

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  function onAttach(a: AgentQueryFns): void {
    agent = a;
  }

  function onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
    if (entryData?.toolStates) {
      const toDisable = Object.entries(entryData.toolStates)
        .filter(([, enabled]) => !enabled)
        .map(([name]) => name);
      if (toDisable.length > 0) {
        const disabled = ensureMap(disabledMap, ctxKey(ctx), () => new Set());
        for (const name of toDisable) disabled.add(name);
      }
    }
  }

  function onRemove(ctx: ToolSetContext): void {
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
    };
  }

  function onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
    const key = ctxKey(ctx);
    const subs = ensureMap(subsMap, key, () => new Set());
    subs.add(fn);
    return () => subs.delete(fn);
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

    // Phase 1: remove disabled tools
    const disabled = disabledMap.get(key);
    const enabled = disabled && disabled.size > 0
      ? tools.filter((t) => !disabled.has(t.name))
      : tools;

    // Phase 2: if above threshold, keep only core tools (rest discoverable via tool_search)
    if (enabled.length > TOOL_SEARCH_THRESHOLD) {
      const coreNames = buildCoreNames();
      return enabled.filter((t) => coreNames.has(t.name));
    }

    return enabled;
  }

  async function onBeforeToolExecute(
    ctx: ToolSetContext,
    toolName: string,
    _tool: Tool,
    _args: Record<string, unknown>,
    execCtx: ToolExecutionContext,
  ): Promise<{ allow: true } | { allow: false; result: ToolResult } | void> {
    const disabled = disabledMap.get(ctxKey(ctx));
    if (disabled?.has(toolName)) {
      return {
        allow: false,
        result: {
          toolCallId: execCtx.toolCallId ?? '',
          name: toolName,
          result: { ok: false, error: `Tool "${toolName}" is currently disabled.` },
        },
      };
    }
    return { allow: true };
  }

  function onGetSystemPrompt(
    ctx: ToolSetContext,
    promptCtx: SystemPromptContext,
    toolSets: readonly ToolSet[],
  ): string | undefined {
    const key = ctxKey(ctx);
    const disabled = disabledMap.get(key);
    let deferredPrompt: string | undefined;

    // Suppress system prompts of fully-disabled ToolSets
    if (disabled && disabled.size > 0) {
      for (const ts of toolSets) {
        if (ts.name === self.name) continue;
        const tsTools = resolveToolSetTools(ts);
        if (tsTools.length === 0) continue;
        if (tsTools.every((t) => disabled.has(t.name))) {
          promptCtx.suppressToolSetPrompt(ts.name);
        }
      }
    }

    // Inject deferred-tool guidance when above threshold
    const allTools = agent?.getTools() ?? [];
    const coreNames = buildCoreNames();
    const deferred = allTools.filter(
      (t) => !coreNames.has(t.name) && !(disabled?.has(t.name) ?? false),
    );
    if (deferred.length > 0) {
      const groups = new Map<string, string[]>();
      for (const t of deferred) {
        const g = t.group ?? 'Other';
        const arr = groups.get(g);
        if (arr) arr.push(t.name);
        else groups.set(g, [t.name]);
      }
      const nameList = [...groups.entries()]
        .map(([g, names]) => `- **${g}**: ${names.join(', ')}`)
        .join('\n');
      deferredPrompt = `${TOOL_SEARCH_GUIDANCE}\n\nAvailable deferred tools:\n${nameList}`;
    }

    return deferredPrompt;
  }

  function toggleTool(ctx: ToolSetContext, name: string): void {
    const key = ctxKey(ctx);
    const disabled = ensureMap(disabledMap, key, () => new Set());
    if (disabled.has(name)) disabled.delete(name);
    else disabled.add(name);
    notifySubscribers(subsMap, key);
  }

  const self: ToolSet<ToolStateSymbolState> & {
    toggleTool(ctx: ToolSetContext, name: string): void;
  } = {
    name: 'ToolState',
    symbol: TOOL_STATE_SYMBOL,
    description: 'Per-scope tool enable/disable management + semantic tool discovery',
    tools: [toolSearchTool],

    onAttach,
    onInit,
    onRemove,
    onGetSymbolState,
    onSubscribe,
    onBuildSnapshot,
    onFilterTools,
    onBeforeToolExecute,
    onGetSystemPrompt,

    toggleTool,
  };

  return self;
}

