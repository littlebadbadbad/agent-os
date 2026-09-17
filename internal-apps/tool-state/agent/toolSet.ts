/**
 * Tool State ToolSet — default-off tool access control.
 *
 * Every scope (main session, sub-agent conversation) starts with ALL tools
 * disabled: the model only sees the resident `manage_tools` tool. The AI
 * batch-enables exactly the tools a step needs — saving tokens and keeping it
 * focused on task-relevant calls (see prompt.ts for the system-prompt
 * guidance this ToolSet injects).
 *
 * Responsibilities:
 *  1. Track and persist per-scope ENABLED sets (default: empty = all off).
 *  2. Filter the visible tool list to resident ∪ (enabled ∖ globally-disabled).
 *  3. Provide the resident `manage_tools` batch tool (atomic, validated).
 *  4. List every hidden tool (name + description) in the system prompt so the
 *     AI knows what exists and can enable it.
 *  5. Suppress system-prompt fragments of fully-hidden ToolSets.
 *  6. Enforce the GLOBAL disabled set (toolButton control): globally-disabled
 *     tools are force-off in every scope — filtered, execution-blocked,
 *     unenable-able (by session or `manage_tools`), and rendered as locked
 *     rows in session panels.
 *  7. Resident tools (`manage_tools`) can never be disabled by anyone and are
 *     hidden from the global panel — they are not user-manageable.
 */

import type { Tool, ToolResult, ToolExecutionContext, SystemPromptContext, AgentQueryFns } from '@agent-type';
import type { ToolSet, ToolSetContext, SessionEntryData } from '@agent-type';
import { ctxKey, resolveToolSetTools } from '@agent-type';
import type { ToolStateEntry, ToolStateSymbolState } from './types';
import type { GlobalToolStore } from './globalStore';
import { globalToolStore } from './globalStore';
import { isResident, resolveDescription } from './toolMeta';
import { createManageToolsTool, type ManageToolsBatchResult } from './manageTools';
import { TOOL_STATE_GUIDANCE, truncateDescription } from './prompt';

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

/** The ToolSet extended with the operations the app bridge / activate need. */
export interface ToolStateToolSet extends ToolSet<ToolStateSymbolState> {
  /** Flip a tool's enabled flag for one scope. Refused for locked/resident. */
  toggleTool(ctx: ToolSetContext, name: string): void;
  /** Union of every attached agent's registered tools (global pool). */
  getToolPool(): readonly Tool[];
}

/**
 * Create the ToolState ToolSet.
 *
 * @param globalStore  Cross-session disabled store backing the toolButton
 *   control. Defaults to the process singleton; injectable for tests.
 */
export function createToolStateToolSet(
  globalStore: GlobalToolStore = globalToolStore,
): ToolStateToolSet {
  /** Per-scope ENABLED tool names — absent/empty means "all tools off". */
  const enabledMap = new Map<string, Set<string>>();
  /** Per-scope pre-filter tool pool — what `onFilterTools` last received. */
  const toolCache = new Map<string, readonly Tool[]>();
  const subsMap = new Map<string, Set<() => void>>();

  // ── Multi-agent attachment ────────────────────────────────────────────────
  // A single ToolSet instance may be registered on several agents at once
  // (the UI's combined app context fans one instance out to both the
  // stream and async agents).  `onAttach` fires once per agent, so per-agent
  // state is keyed by the agent's stable id — never a single shared ref.

  /** Agents attached so far, keyed by their `id` (matches `agentName`). */
  const attachedAgents = new Map<string, AgentQueryFns>();
  /** Last attached agent — fallback for test mocks / legacy single-agent use. */
  let fallbackAgent: AgentQueryFns | null = null;

  // A global toggle affects EVERY scope: notify all per-scope subscribers so
  // mounted session panels (and their badges) refresh immediately.
  globalStore.subscribe(() => {
    for (const key of subsMap.keys()) notifySubscribers(subsMap, key);
  });

  // ── Visibility (single source of truth) ───────────────────────────────────

  /**
   * Whether a tool is visible (callable) in a scope:
   * resident tools always; otherwise enabled at this scope AND not globally
   * locked.
   */
  function isVisible(key: string, name: string): boolean {
    if (isResident(name)) return true;
    if (globalStore.isDisabled(name)) return false;
    return enabledMap.get(key)?.has(name) === true;
  }

  /** Enabled / disabled name lists for a scope, derived from a tool pool. */
  function stateLists(key: string, pool: readonly Tool[]): { enabled: string[]; disabled: string[] } {
    const enabled: string[] = [];
    const disabled: string[] = [];
    for (const t of pool) (isVisible(key, t.name) ? enabled : disabled).push(t.name);
    return { enabled, disabled };
  }

  /** The tool pool a scope may reference: its last filter run, else global. */
  function poolFor(key: string): readonly Tool[] {
    return toolCache.get(key) ?? getToolPool();
  }

  // ── manage_tools (resident batch switcher) ────────────────────────────────

  function batch(
    ctx: ToolSetContext,
    enable: readonly string[],
    disable: readonly string[],
  ): ManageToolsBatchResult {
    const key = ctxKey(ctx);
    const pool = poolFor(key);
    const poolNames = new Set(pool.map((t) => t.name));
    const errors: string[] = [];

    const both = new Set(enable.filter((n) => disable.includes(n)));
    for (const name of both) errors.push(`Tool "${name}" appears in both \`enable\` and \`disable\`.`);

    for (const name of enable) {
      if (!poolNames.has(name)) errors.push(`Unknown tool "${name}".`);
      else if (isResident(name)) {
        // Already always-enabled — enabling it is a harmless no-op.
      } else if (globalStore.isDisabled(name)) {
        errors.push(`Tool "${name}" is globally disabled by the user and cannot be enabled.`);
      }
    }
    for (const name of disable) {
      if (!poolNames.has(name)) errors.push(`Unknown tool "${name}".`);
      else if (isResident(name)) errors.push(`Tool "${name}" is resident and cannot be disabled.`);
    }

    // Atomic: any invalid name rejects the whole batch, current state returned
    // unchanged so the AI can fix the names and retry.
    if (errors.length > 0) {
      const { enabled, disabled } = stateLists(key, pool);
      return { enabled, disabled, errors };
    }

    const set = ensureMap(enabledMap, key, () => new Set<string>());
    for (const name of enable) set.add(name);
    for (const name of disable) set.delete(name);
    notifySubscribers(subsMap, key);

    const lists = stateLists(key, pool);
    return { ...lists, errors };
  }

  const manageToolsTool = createManageToolsTool({ batch });

  // ── Lifecycle hooks ────────────────────────────────────────────────────────

  function onAttach(a: AgentQueryFns): void {
    fallbackAgent = a;
    if (a.id) attachedAgents.set(a.id, a);
  }

  /**
   * Restore from a persisted snapshot: the saved enabled set is kept
   * (default-off applies only to scopes with no recorded tool state).
   */
  function onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
    if (!entryData?.toolStates) return;
    for (const [name, enabled] of Object.entries(entryData.toolStates)) {
      if (enabled) ensureMap(enabledMap, ctxKey(ctx), () => new Set<string>()).add(name);
    }
  }

  function onRemove(ctx: ToolSetContext): void {
    const key = ctxKey(ctx);
    enabledMap.delete(key);
    toolCache.delete(key);
    subsMap.delete(key);
  }

  function onGetSymbolState(ctx: ToolSetContext, stateCtx?: { readonly tools: readonly Tool[] }): ToolStateSymbolState {
    const key = ctxKey(ctx);
    const tools = stateCtx?.tools ?? toolCache.get(key) ?? [];
    const toolStates: ToolStateEntry[] = tools.map((t) => ({
      name: t.name,
      description: resolveDescription(t),
      enabled: isVisible(key, t.name),
      locked: globalStore.isDisabled(t.name),
      resident: isResident(t.name),
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
    const enabled = enabledMap.get(key);
    if (!tools.length && !enabled?.size) return {};
    const toolStates: Record<string, boolean> = {};
    for (const t of tools) {
      // Resident tools persist as always-enabled; harmless on restore.
      toolStates[t.name] = isResident(t.name) || enabled?.has(t.name) === true;
    }
    if (enabled) {
      for (const name of enabled) {
        if (!(name in toolStates)) toolStates[name] = true;
      }
    }
    return { toolStates };
  }

  function onFilterTools(ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
    const key = ctxKey(ctx);
    toolCache.set(key, tools);
    return tools.filter((t) => isVisible(key, t.name));
  }

  async function onBeforeToolExecute(
    ctx: ToolSetContext,
    toolName: string,
    _tool: Tool,
    _args: Record<string, unknown>,
    execCtx: ToolExecutionContext,
  ): Promise<{ allow: true } | { allow: false; result: ToolResult } | void> {
    if (!isVisible(ctxKey(ctx), toolName)) {
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
    const pool = toolCache.get(key) ?? [];

    // Suppress system prompts of fully-hidden ToolSets — their tools are all
    // off, so their instructions would only mislead the model.
    for (const ts of toolSets) {
      if (ts.name === self.name) continue;
      const tsTools = resolveToolSetTools(ts);
      if (tsTools.length === 0) continue;
      if (tsTools.every((t) => !isVisible(key, t.name))) {
        promptCtx.suppressToolSetPrompt(ts.name);
      }
    }

    // Catalogue every enable-able hidden tool so the AI knows what exists.
    // Globally-locked tools are excluded — listing them would invite
    // enable attempts the user has explicitly forbidden.
    const hidden = pool.filter(
      (t) => !isVisible(key, t.name) && !globalStore.isDisabled(t.name),
    );
    if (hidden.length === 0) return undefined;

    const groups = new Map<string, string[]>();
    for (const t of hidden) {
      const g = t.group ?? 'Other';
      const line = `\`${t.name}\` — ${truncateDescription(resolveDescription(t))}`;
      const arr = groups.get(g);
      if (arr) arr.push(line);
      else groups.set(g, [line]);
    }
    const catalogue = [...groups.entries()]
      .map(([g, lines]) => `- **${g}**\n${lines.map((l) => `  - ${l}`).join('\n')}`)
      .join('\n');
    return `${TOOL_STATE_GUIDANCE}\n\n### Disabled tools (enable with \`manage_tools\`)\n\n${catalogue}`;
  }

  function toggleTool(ctx: ToolSetContext, name: string): void {
    // Resident tools are always on; globally-disabled tools cannot be
    // re-enabled from a single session.
    if (isResident(name) || globalStore.isDisabled(name)) return;
    const key = ctxKey(ctx);
    const enabled = ensureMap(enabledMap, key, () => new Set<string>());
    if (enabled.has(name)) enabled.delete(name);
    else enabled.add(name);
    notifySubscribers(subsMap, key);
  }

  /** Union of every attached agent's tool pool, deduplicated by name. */
  function getToolPool(): readonly Tool[] {
    const seen = new Map<string, Tool>();
    for (const agent of attachedAgents.values()) {
      for (const tool of agent.getTools()) {
        if (!seen.has(tool.name)) seen.set(tool.name, tool);
      }
    }
    if (seen.size === 0 && fallbackAgent) {
      for (const tool of fallbackAgent.getTools()) seen.set(tool.name, tool);
    }
    return [...seen.values()];
  }

  const self: ToolStateToolSet = {
    name: 'ToolState',
    symbol: TOOL_STATE_SYMBOL,
    description: 'Default-off tool access control with the resident manage_tools batch switcher',
    tools: [manageToolsTool],

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
    getToolPool,
  };

  return self;
}
