// ── Module augmentation ───────────────────────────────────────────────────────
// Injects tool-toggle state into AgentSessionState without touching SDK core.

import type { ToolStateEntry } from '../../client/types';

export {};

declare module '@agent-type' {
  interface AgentSessionExtension {
    /**
     * Toggle a tool's enabled/disabled state by name.
     *
     * Populated only when `createToolStateToolSet` is registered.
     * No-op (field absent) otherwise.
     */
    toggleTool?: (name: string) => void;
    /** Snapshot of all registered tools with their enabled/disabled state. */
    toolStates: ToolStateEntry[];
  }
}

declare module '@agent-type' {
  interface SessionEntryExtension {
    /**
     * Tool enabled/disabled overrides.
     * Key = tool name, value = `true` (enabled) or `false` (disabled).
     */
    toolStates?: Record<string, boolean>;
  }
}

/**
 * ToolStateToolSet — optional external ToolSet that owns all tool
 * enable/disable state.
 *
 * Register via `createAgentClient({ toolSets: [createToolStateToolSet()] })`.
 *
 * Without this ToolSet registered:
 *   - All tools are always visible to the AI (no filtering).
 *   - `AgentSessionState.toolStates` stays `[]`.
 *   - `AgentSessionState.toggleTool` is absent.
 *
 * With this ToolSet registered, it intercepts every point where tools are
 * turned into AI descriptors or execution-callable registries, filtering out
 * disabled tools for the relevant session / sub-agent scope.
 *
 * The returned object exposes a control API for programmatic enable/disable.
 */

import type { Tool, ToolResult, ToolExecutionContext, SystemPromptContext } from '@agent-type';
import { ctxKey, TOOL_STATE_TOOLSET_BRAND } from '../toolSet';
import { ToolSet, ToolSetContext, resolveToolSetTools } from '@agent-type';
import type { SessionEntryData } from '@agent-type';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Control API returned by `createToolStateToolSet`.
 * Use this to programmatically enable/disable tools from outside the agent.
 *
 * `ctx` is a `ToolSetContext` identifying the session / sub-agent scope.
 */
export type ToolStateControl = {
  toggleTool(ctx: ToolSetContext, name: string): void;
  disableNames(ctx: ToolSetContext, names: ReadonlySet<string>): void;
  enableNames(ctx: ToolSetContext, names: ReadonlySet<string>): void;
  /**
   * Disable all tools in a group for the given scope.
   * Uses the tool list cached by the most recent `onFilterTools` call for
   * that scope — no-op if the scope has not yet had a turn.
   */
  disableGroup(ctx: ToolSetContext, group: string): void;
  /**
   * Enable all tools in a group for the given scope.
   * Uses the tool list cached by the most recent `onFilterTools` call.
   */
  enableGroup(ctx: ToolSetContext, group: string): void;
  getDisabledNames(ctx: ToolSetContext): ReadonlySet<string>;
};

export type ToolStateToolSet = ToolSet & ToolStateControl & {
  readonly [TOOL_STATE_TOOLSET_BRAND]: true;
};

// ── Type guard ────────────────────────────────────────────────────────────────

export function isToolStateToolSet(ts: ToolSet): ts is ToolStateToolSet {
  return (ts as ToolStateToolSet)[TOOL_STATE_TOOLSET_BRAND] === true;
}

/**
 * Find the first registered ToolStateToolSet in a list of ToolSets,
 * or return `undefined` if none is registered.
 */
export function findToolStateToolSet(toolSets: readonly ToolSet[]): ToolStateToolSet | undefined {
  return toolSets.find(isToolStateToolSet);
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createToolStateToolSet(): ToolStateToolSet {
  /** Disabled tool names per scope key. */
  const disabledMap = new Map<string, Set<string>>();
  /** Tool list cache per scope (populated by onFilterTools; used by disableGroup). */
  const toolCache = new Map<string, readonly Tool[]>();
  /** Subscribers per scope key. */
  const subsMap = new Map<string, Set<() => void>>();

  // ── Internal helpers ──────────────────────────────────────────────────────

  function getDisabled(key: string): Set<string> {
    let s = disabledMap.get(key);
    if (!s) { s = new Set(); disabledMap.set(key, s); }
    return s;
  }

  function notifyScope(key: string): void {
    const subs = subsMap.get(key);
    if (subs) for (const fn of subs) fn();
  }

  // ── ToolSet hooks ──────────────────────────────────────────────────────────

  function onInitSession(ctx: ToolSetContext, entryData: SessionEntryData): void {
    // Restore disabled-tool state from a persisted snapshot (main agent only).
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

  function onGetState(ctx: ToolSetContext, stateCtx?: { readonly tools: readonly Tool[] }): Record<string, unknown> {
    const key = ctxKey(ctx);
    const tools = stateCtx?.tools ?? toolCache.get(key) ?? [];
    const disabled = disabledMap.get(key);
    const toolStates: ToolStateEntry[] = tools.map((t) => ({
      name: t.name,
      description: typeof t.description === 'function' ? t.description() : t.description,
      enabled: !disabled?.has(t.name),
      group: t.group,
    }));
    return { toolStates, toggleTool: (name: string) => toggleTool(ctx, name) };
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
    // Also persist names that are disabled but not in the current cache
    // (e.g. restored from a previous snapshot and not yet observed in a turn).
    if (disabled) {
      for (const name of disabled) {
        if (!(name in toolStates)) toolStates[name] = false;
      }
    }
    return { toolStates };
  }

  function onFilterTools(ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
    const key = ctxKey(ctx);
    // Cache the full tool list so disableGroup can resolve names.
    toolCache.set(key, tools);
    const disabled = disabledMap.get(key);
    if (!disabled || disabled.size === 0) return tools;
    return tools.filter((t) => !disabled.has(t.name));
  }

  /**
   * Execution-time guard: blocks calls to disabled tools.
   *
   * `onFilterTools` only controls *visibility* — the AI should never see a
   * disabled tool in the schema.  However, the model can still emit a stale
   * tool name from a previous turn (or hallucinate one), so we intercept the
   * actual execution here and return a failure result instead of running the
   * tool.
   *
   * The `toolCallId` is left as `''` — the caller (`runToolCall`) matches
   * results by `call.id`, not by the result's `toolCallId`.  This mirrors the
   * pattern used by the permissions ToolSet.
   */
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
        result: {
          ok: false,
          error: `Tool "${toolName}" is currently disabled and cannot be executed.`,
        },
      };
      return { allow: false, result };
    }
    return { allow: true };
  }

  /**
   * System-prompt suppression: when every tool in a ToolSet is disabled for
   * the current scope, mark that ToolSet's prompt for suppression.
   *
   * The base layer still calls the target ToolSet's `onGetSystemPrompt`
   * (execution is unaffected), but discards the returned fragment so the
   * model never sees guidance for tools it cannot use.
   *
   * ToolSets with zero tools (e.g. this one) are never suppressed.
   */
  function onGetSystemPrompt(
    ctx: ToolSetContext,
    promptCtx: SystemPromptContext,
    toolSets: readonly ToolSet[],
  ): undefined {
    const disabled = disabledMap.get(ctxKey(ctx));
    if (!disabled || disabled.size === 0) return;

    for (const ts of toolSets) {
      if (ts === toolStateSelf) continue; // Don't suppress ourselves.
      const tools = resolveToolSetTools(ts);
      if (tools.length === 0) continue; // No tools → nothing to suppress.
      const allDisabled = tools.every((t) => disabled.has(t.name));
      if (allDisabled) {
        promptCtx.suppressToolSetPrompt(ts.name);
      }
    }
    return;
  }

  // ── Control API ───────────────────────────────────────────────────────────

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
    if (!cached) return; // No-op until first turn has populated the cache.
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
    tools: [],
    [TOOL_STATE_TOOLSET_BRAND]: true as const,

    onInitSession,
    onRemoveSession,
    onGetState,
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
