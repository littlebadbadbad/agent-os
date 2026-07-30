/**
 * System-prompt guidance for deferred tool discovery.
 */

export const TOOL_SEARCH_GUIDANCE = `## Available Deferred Tools

Some tools are deferred and not shown in your tool list. If you need a tool that is not visible:

1. Call \`tool_search(query)\` with one or more space-separated keywords describing what you need (e.g. \`"read file"\`, \`"git diff"\`)
2. The best match is returned with its full parameter schema — use it to construct the correct arguments
3. Call the returned tool directly by name — it will be loaded and executed normally
4. If the best match isn't what you need, check the \`others\` list for alternatives`;
