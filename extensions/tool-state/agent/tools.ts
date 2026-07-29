import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { Tool, ToolExecutionContext } from '@agent-type';
import { ctxKey } from '@agent-type';
import type { ToolSearchResult } from './types';

/** Tools stay visible to the model. Beyond this threshold they're deferred behind `tool_search`. */
export const TOOL_SEARCH_THRESHOLD = 30;

/**
 * Create the `tool_search` tool.
 *
 * Searches deferred (non-core) tools by keyword, excluding disabled tools.
 * The search is case-insensitive and matches both tool names and descriptions.
 */
export function createToolSearchTool(
  allTools: () => readonly Tool[],
  coreNames: () => ReadonlySet<string>,
  disabledNamesByScope: (scopeKey: string) => ReadonlySet<string>,
) {
  return defineTool({
    name: 'tool_search',
    group: 'Tool Management',
    description:
      'Search for tools by keyword. ' +
      'Use this when you need a tool that is not in your visible tool list. ' +
      'Provide a keyword and the matching tools (name + summary) will be returned. ' +
      'You can then call the returned tools directly.',
    parameters: z.object({
      query: z.string().min(1).describe('Search keyword to find relevant tools.'),
    }),
    execute: async ({ query }, context: ToolExecutionContext) => {
      const tools = allTools();
      const core = coreNames();
      const scopeKey = ctxKey(context);
      const disabled = disabledNamesByScope(scopeKey);
      const lower = query.toLowerCase();

      const results: ToolSearchResult[] = tools
        .filter((t) => !core.has(t.name))
        .filter((t) => !disabled.has(t.name))
        .filter((t) => {
          const desc = typeof t.description === 'function' ? t.description() : t.description;
          return t.name.includes(lower) || desc.toLowerCase().includes(lower);
        })
        .slice(0, 15)
        .map((t) => ({
          name: t.name,
          summary: (typeof t.description === 'function' ? t.description() : t.description)
            .split('\n')[0]
            .slice(0, 120),
        }));

      if (results.length === 0) {
        return {
          results: [],
          message: `No deferred tools found matching "${query}". The tool may be disabled, a core tool (always visible), or may not exist.`,
        };
      }

      return {
        results,
        count: results.length,
        hint: 'Call any of these tools by name directly. The tool will be loaded and executed.',
      };
    },
  });
}

