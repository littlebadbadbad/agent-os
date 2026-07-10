import { MAIN_CONVERSATION_ID, type ToolSet, type ToolSetContext } from "@agent-type";
import type { BrowserAdapter } from "./types";
import { createBrowserTools } from "./tools";

export const BROWSER_SYMBOL = Symbol("browser");

export function createBrowserToolSet(adapter: BrowserAdapter): ToolSet {
  const { tools, getSystemPrompt } = createBrowserTools(adapter);
  return {
    symbol: BROWSER_SYMBOL,
    name: "browser",
    coreTools: [
      "browser_launch",
      "browser_navigate",
      "browser_run",
      "browser_snapshot",
    ],
    tools,
    onGetSystemPrompt: getSystemPrompt,
    onGetSymbolState: (_ctx: ToolSetContext) => ({
      browserAdapter: adapter,
      slots: [
        {
          type: "panel",
          label: "Browser",
          showTab: (ctx) => ctx.conversationId === MAIN_CONVERSATION_ID,
          order: 50,
        },
        {
          type: "compactToolCard",
          toolNames: tools.map((t) => t.name),
        },
        {
          type: "toolCard",
          toolNames: tools.map((t) => t.name),
        },
      ],
    }),
  };
}
