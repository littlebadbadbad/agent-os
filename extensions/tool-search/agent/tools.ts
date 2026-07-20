/**
 * ToolSearch tool — lets the agent search for deferred tools by keyword.
 *
 * When the total tool count exceeds `TOOL_SEARCH_THRESHOLD`, most tools are
 * deferred (hidden from the initial tool list).  The AI must call this tool
 * to find and use them.
 *
 * @module
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { Tool } from '@agent-type';
import type { ToolSearchResult } from './types';

/**
 * Create the `tool_search` tool.
 *
 * @param allTools      All registered tools (used to build search index).
 * @param coreNames     Set of tool names that are always visible (never deferred).
 * @returns The tool_search tool definition.
 */
export function createToolSearchTool(
  allTools: () => readonly Tool[],
  coreNames: ReadonlySet<string>,
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
    execute: async ({ query }) => {
      const tools = allTools();
      const lower = query.toLowerCase();

      const results: ToolSearchResult[] = tools
        .filter((t) => !coreNames.has(t.name)) // only deferred tools
        .filter((t) => {
          const desc = typeof t.description === 'function' ? t.description() : t.description;
          return t.name.includes(lower) || desc.toLowerCase().includes(lower);
        })
        .slice(0, 15) // limit results
        .map((t) => ({
          name: t.name,
          summary: (typeof t.description === 'function' ? t.description() : t.description).split('\n')[0].slice(0, 120),
        }));

      if (results.length === 0) {
        return {
          results: [],
          message: `No deferred tools found matching "${query}". The tool may not exist or may be a core tool (always visible).`,
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
