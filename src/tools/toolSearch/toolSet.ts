/**
 * ToolSearch ToolSet — filters the tool list when it exceeds the threshold,
 * keeping only core tools visible and deferring the rest.
 *
 * Uses `onFilterTools` to hide deferred tools from the AI.
 * The AI can discover them via `tool_search`.
 *
 * @module
 */

import type { ToolSet, ToolSetContext, AgentQueryFns, SystemPromptContext } from '@agent-type';
import type { Tool } from '@agent-type';
import { createToolSearchTool } from './tools';
import { TOOL_SEARCH_GUIDANCE } from './prompt';

/**
 * Create a ToolSearch ToolSet.
 *
 * When the total registered tool count exceeds `TOOL_SEARCH_THRESHOLD`,
 * the `onFilterTools` hook restricts the visible tools to the core set,
 * and the `tool_search` tool is provided for discovery.
 *
 * Core tool names are aggregated from two sources (evaluated lazily on every
 * filter turn so dynamically-registered ToolSets are always included):
 * 1. The static `CORE_TOOL_NAMES` baseline in `./types`.
 * 2. Each registered ToolSet's own `coreTools` declaration — ToolSets declare
 *    the tools their workflows depend on, keeping the decision local to the
 *    ToolSet that owns those tools.
 *
 * @example
 * ```ts
 * const agent = createAgentClient({
 *   handler,
 *   toolSets: [createToolSearchToolSet()],
 * });
 * ```
 */
export function createToolSearchToolSet(): ToolSet {
  let _agent: AgentQueryFns | null = null;

  const toolSearchTool = createToolSearchTool(
    () => _agent?.getTools() ?? [],
    // coreNames forwarded lazily — resolved fresh on each tool_search call.
    { has: (name: string) => buildCoreNames().has(name) } as ReadonlySet<string>,
  );

  /** Build the effective core set from all registered ToolSet `coreTools` declarations. */
  function buildCoreNames(): Set<string> {
    // Always include the search tool itself.
    const names = new Set<string>(['tool_search']);
    if (_agent) {
      for (const ts of _agent.getRegisteredToolSets()) {
        if (ts.coreTools) {
          for (const name of ts.coreTools) names.add(name);
        }
      }
    }
    return names;
  }

  return {
    name: 'tool-search',
    description: 'Filters tools when >30 are registered, exposing a search tool for discovery',
    tools: [toolSearchTool],

    onAttach(agent): void {
      _agent = agent;
    },

    /**
     * Inject tool-search guidance + a grouped list of deferred tool names.
     * Only active when tool count exceeds the threshold so the prompt stays
     * clean for small tool sets.
     */
    onGetSystemPrompt(_ctx: ToolSetContext, _promptCtx: SystemPromptContext): string | undefined {
      const tools = _agent?.getTools() ?? [];
      const coreNames = buildCoreNames();
      const deferred = tools.filter((t) => !coreNames.has(t.name));
      if (deferred.length === 0) return undefined;

      // Group deferred tools by their `group` field for readability.
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

      return `${TOOL_SEARCH_GUIDANCE}\n\nAvailable deferred tools:\n${nameList}`;
    },

    /**
     * When the tool count exceeds the threshold, hide deferred tools.
     * Core tools (static baseline + each ToolSet's `coreTools`) are always
     * visible; the rest can be discovered via `tool_search`.
     */
    onFilterTools(_ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
      const coreNames = buildCoreNames();
      return tools.filter((t) => coreNames.has(t.name));
    },
  };
}
