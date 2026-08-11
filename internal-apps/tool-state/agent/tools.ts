import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { Tool, ToolExecutionContext, AgentQueryFns } from '@agent-type';
import { ctxKey } from '@agent-type';
import type { ToolSearchDetail, ToolSearchSummary, ToolSearchResults } from './types';
import { scoreTool, resolveDescription } from './scoring';
/** Tools stay visible to the model. Beyond this threshold they're deferred behind `tool_search`. */
export const TOOL_SEARCH_THRESHOLD = 30;

/** Maximum number of results returned by tool_search. */
const MAX_RESULTS = 15;

function parametersToJsonSchema(tool: Tool): Record<string, unknown> {
  if (tool.rawParametersSchema) {
    return typeof tool.rawParametersSchema === 'function'
      ? tool.rawParametersSchema()
      : tool.rawParametersSchema;
  }

  const zodSchema = typeof tool.parameters === 'function'
    ? tool.parameters()
    : tool.parameters;

  const raw = z.toJSONSchema(zodSchema, { reused: 'inline' });

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== '$schema') {
      result[key] = value;
    }
  }
  return result;
}

function noMatches(query: string): ToolSearchResults {
  return {
    top: null,
    others: [],
    total: 0,
  };
}

/**
 * Names of tools that stay visible to the model — `tool_search` itself plus
 * every `coreTools` entry declared across the agent's registered ToolSets.
 *
 * Core names are **per-agent**: agents register different ToolSets
 * (e.g. `subagent-stream` vs `subagent-async`), so the set must be derived
 * from the agent the current call belongs to, never a shared closure.
 */
export function buildCoreNames(agent: AgentQueryFns | null): Set<string> {
  const names = new Set<string>(['tool_search']);
  if (agent) {
    for (const ts of agent.getRegisteredToolSets()) {
      const coreTools = ts.coreTools;
      if (coreTools) {
        for (const name of coreTools) names.add(name);
      }
    }
  }
  return names;
}

/**
 * The search space for a single `tool_search` invocation.
 *
 * - **pool** — the tools that may be surfaced.  For the main agent this is
 *   the full registered pool; for a sub-agent it is its own allow-list
 *   (`tool_names`) — never the parent's pool, which would leak tools the
 *   sub-agent cannot execute.
 * - **core** — names excluded from results because they are always visible
 *   to the model (no search needed).
 */
export type ToolSearchScope = {
  readonly pool: readonly Tool[];
  readonly core: ReadonlySet<string>;
};

/**
 * Create the `tool_search` tool.
 *
 * Accepts one or more space-separated keywords, scores deferred (non-core,
 * non-disabled) tools by relevance, and returns:
 *
 * - **top** — the best match with full description and complete JSON Schema
 *   parameters so the AI can invoke the tool immediately.
 * - **others** — remaining matches (≤14) with name and description only.
 *
 * `resolveScope` is invoked with the **current execution context** so a shared
 * ToolSet instance (registered on several agents at once) always searches the
 * pool of the scope that actually called `tool_search` — for sub-agents that
 * scope is their granted allow-list, keeping results executable.
 */
export function createToolSearchTool(
  resolveScope: (ctx: ToolExecutionContext) => ToolSearchScope,
  disabledNamesByScope: (scopeKey: string) => ReadonlySet<string>,
) {
  return defineTool({
    name: 'tool_search',
    group: 'Tool Management',
    description:
      'Search for deferred tools by one or more space-separated keywords. ' +
      'The best match is returned with its full parameter schema so you can call it directly. ' +
      'Use this when the tool you need is not in your visible tool list.',
    parameters: z.object({
      query: z.string().min(1).describe(
        'One or more space-separated keywords, e.g. "file read" or "git commit". ' +
        'Matches against tool name, description, and group.',
      ),
    }),
    execute: async ({ query }, context: ToolExecutionContext) => {
      const { pool, core } = resolveScope(context);
      const scopeKey = ctxKey(context);
      const disabled = disabledNamesByScope(scopeKey);

      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0);

      if (queryWords.length === 0) {
        return noMatches(query);
      }

      const deferred = pool.filter(
        (t) => !core.has(t.name) && !disabled.has(t.name),
      );

      if (deferred.length === 0) {
        return noMatches(query);
      }

      const scored = deferred
        .map((tool) => ({ tool, score: scoreTool(tool, queryWords) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);

      if (scored.length === 0) {
        return noMatches(query);
      }

      const [best, ...rest] = scored;

      const top: ToolSearchDetail = {
        name: best.tool.name,
        description: resolveDescription(best.tool),
        parameters: parametersToJsonSchema(best.tool),
        score: best.score,
      };

      const others: ToolSearchSummary[] = rest.map((entry) => ({
        name: entry.tool.name,
        description: resolveDescription(entry.tool),
        score: entry.score,
      }));

      return {
        top,
        others,
        total: scored.length,
      };
    },
  });
}

