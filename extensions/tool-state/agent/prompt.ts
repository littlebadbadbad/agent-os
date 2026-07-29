/**
 * System-prompt guidance for deferred tool discovery.
 */

export const TOOL_SEARCH_GUIDANCE = `## Available Deferred Tools

Some tools are deferred and not shown in your tool list. If you need a tool that isn't visible:

1. Call \`tool_search(query)\` with a keyword for the operation you want to perform
2. The search returns matching tool names with brief descriptions
3. Call the returned tool directly — it will be loaded and executed normally`;
