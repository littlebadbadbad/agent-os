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

import type { Tool, ToolResult, ToolExecutionContext, SystemPromptContext, AgentQueryFns } from '@agent-type';
import type { ToolSet, ToolSetContext, SessionEntryData } from '@agent-type';
import { ctxKey, resolveToolSetTools } from '@agent-type';
import type { ToolStateEntry, ToolStateSymbolState } from './types';
import { createToolSearchTool, buildCoreNames, TOOL_SEARCH_THRESHOLD, type ToolSearchScope } from './tools';
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

  // ── Multi-agent attachment ────────────────────────────────────────────────
  // A single ToolSet instance may be registered on several agents at once
  // (the UI's combined plugin context fans one instance out to both the
  // stream and async agents).  `onAttach` fires once per agent, so per-agent
  // state is keyed by the agent's stable id — never a single shared ref.

  /** Agents attached so far, keyed by their `id` (matches `agentName`). */
  const attachedAgents = new Map<string, AgentQueryFns>();
  /**
   * Root session → owning agent.  Sub-agent calls share the root sessionId,
   * so a sub-agent's `tool_search` still resolves its parent's pool.
   */
  const sessionOwners = new Map<string, AgentQueryFns>();
  /** Last attached agent — fallback for test mocks / legacy single-agent use. */
  let fallbackAgent: AgentQueryFns | null = null;

  /**
   * Per-scope pre-filter tool pool — the tools `onFilterTools` received for
   * a given scope key, BEFORE disabled-tool removal / core deferral.
   *
   * For the main agent this is the full registered pool; for a sub-agent it
   * is its granted allow-list (`tool_names`).  `tool_search` searches THIS
   * pool — never the parent agent's complete pool — so a restricted
   * sub-agent can only ever discover tools it was actually granted.
   */
  const scopePools = new Map<string, readonly Tool[]>();

  /** Resolve the agent that owns the given execution context. */
  function resolveAgent(ctx: { agentName: string; sessionId: string }): AgentQueryFns | null {
    return attachedAgents.get(ctx.agentName) ?? sessionOwners.get(ctx.sessionId) ?? fallbackAgent;
  }

  /** Resolve the search scope for the given execution context. */
  function resolveScope(ctx: { agentName: string; sessionId: string; conversationId: string }): ToolSearchScope {
    const agent = resolveAgent(ctx);
    const scopePool = scopePools.get(ctxKey(ctx));
    return {
      // Prefer the scope's own pool (sub-agent allow-list); fall back to the
      // agent's pool only when no filter run has recorded one (tests, early calls).
      pool: scopePool ?? agent?.getTools() ?? [],
      core: buildCoreNames(agent),
    };
  }

  // ── Disabled-name lookup (per key, used by tool_search) ────────────────────

  function getDisabledForScope(key: string): ReadonlySet<string> {
    return disabledMap.get(key) ?? new Set<string>();
  }

  // ── tool_search (lazy: resolves scope + disabled names fresh on each call) ─

  const toolSearchTool = createToolSearchTool(
    resolveScope,
    (key: string) => getDisabledForScope(key),
  );

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  function onAttach(a: AgentQueryFns): void {
    fallbackAgent = a;
    if (a.id) attachedAgents.set(a.id, a);
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
    scopePools.delete(key);
    sessionOwners.delete(ctx.sessionId);
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
    // Record the pre-filter pool for this scope — `tool_search` searches it,
    // so sub-agents only ever discover their own granted tools.
    scopePools.set(key, tools);

    // Record the owning agent for this session (main-session filter runs carry
    // the agent id as `agentName`) so sub-agent calls can resolve it later.
    const agent = resolveAgent(ctx);
    if (agent) sessionOwners.set(ctx.sessionId, agent);

    // Phase 1: remove disabled tools
    const disabled = disabledMap.get(key);
    const enabled = disabled && disabled.size > 0
      ? tools.filter((t) => !disabled.has(t.name))
      : tools;

    // Phase 2: if above threshold, keep only core tools (rest discoverable via tool_search)
    if (enabled.length > TOOL_SEARCH_THRESHOLD) {
      const coreNames = buildCoreNames(agent);
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
    const agent = resolveAgent(ctx);
    const scopePool = scopePools.get(ctxKey(ctx));
    const allTools = scopePool ?? agent?.getTools() ?? [];
    const coreNames = buildCoreNames(agent);
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

