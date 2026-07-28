/**
 * extensions/dynamic-tool/agent/toolSet.ts — Dynamic tool ToolSet
 */

import type { ToolSet, AgentQueryFns, AgentClientLike, SystemPromptContext, ToolSetContext, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import type { DynamicToolAdapter } from './types';
import { createProxyStore } from './proxy';
import { createToolCrudTools } from './toolTools';
import { createModuleTools } from './moduleTools';
import { createDepTools } from './depTools';

const SYSTEM_PROMPT = `\
## Dynamic Tools

You can create backend tools (Node.js ESM on server) and frontend tools (inline JS in browser).

### Backend Tool (\`runtime: "backend"\`)
- \`implementation\`: full ESM module exporting \`async function run(args, context)\`
- \`context\` available: \`{ sessionId, agentName, conversationId, proxyRequest }\`
- Can import \`#modules/<name>\` (shared modules) and installed npm packages
- \`proxyRequest(url, init?)\`: like \`fetch\` but routes through configured proxy — use for foreign/blocked APIs. Falls back to direct fetch when no proxy configured.

### Frontend Tool (\`runtime: "frontend"\`)
- \`implementation\`: bare function body \`(args, context) => { ... }\` (no export/function wrapper)
- \`context\` available: full \`ToolExecutionContext\` — \`requestUserInput\`, \`cancelUserInput\`, \`sendMessage\`, \`signal\`, \`handler\`, \`sessionId\`, \`agentName\`, \`conversationId\`, \`sourceAgent\`, \`isSubAgent\`

### Shared Modules (\`create_module\` / \`update_module\`)
Reusable ESM code imported by backend tools: \`import { x } from '#modules/name'\`
- Use kebab-case names (e.g. \`"string-utils"\`)
- Must contain at least one \`export\`
- Call \`list_modules\` before creating — prefer \`update_module\` over duplicates

### npm Dependencies (\`install_tool_deps\`)
Install packages for backend tools: \`install_tool_deps(["axios", "date-fns@3"])\`
After install, import normally: \`import axios from 'axios'\`
Call \`list_tool_deps\` first — the package may already be installed.`;

export const DYNAMIC_TOOL_SYMBOL = Symbol('dynamic-tool');

function dynamicToolDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === 'running' ? `${info.name}…` : info.name;
  return { icon: '⚡', label: 'Tool', summary, status: info.status };
}

export function createDynamicToolset(adapter: DynamicToolAdapter): ToolSet {
  const proxyStore = createProxyStore(adapter);
  const toolCrudTools = createToolCrudTools(adapter, proxyStore.register, proxyStore.unregister);
  const moduleToolsArr = createModuleTools(adapter);
  const depToolsArr = createDepTools(adapter);

  const tools = [...toolCrudTools, ...moduleToolsArr, ...depToolsArr] as const;

  return {
    name: 'dynamic-tools',
    symbol: DYNAMIC_TOOL_SYMBOL,
    description: 'Manages dynamically created agent tools, shared modules, and npm dependencies.',
    tools,
    coreTools: ['create_tool', 'update_tool', 'list_dynamic_tools', 'create_module', 'install_tool_deps'],

    onAttach(agent: AgentQueryFns): (() => void) | void {
      // Defer backend hydration to onAttach — at factory-construction time the
      // backend plugin's IPC handlers may not yet be registered, causing a
      // "No handler registered" error when adapter.listTools() fires an IPC call.
      // By the time onAttach fires, the backend plugin has been activated and
      // the IPC route is available.
      adapter.listTools()
        .then((entries) => { for (const entry of entries) proxyStore.register(entry); })
        .catch((err: unknown) => {
          console.warn('[dynamicToolset] startup hydration failed:', (err as Error)?.message ?? err);
        });
      return proxyStore.buildOnAttach(agent as AgentClientLike);
    },

    onGetSystemPrompt(_ctx: ToolSetContext, _promptCtx: SystemPromptContext): string {
      return SYSTEM_PROMPT;
    },

    onGetSymbolState: (_ctx: ToolSetContext) => ({
      type: 'dynamic-tool' as const,
    }),
  };
}

export function getDynamicToolSlotDeclarations(
  toolNames: readonly string[],
): readonly PluginSlotDeclaration[] {
  return [
    { type: 'toolCard' as const, toolNames },
    { type: 'compactToolCard' as const, toolNames, getDescriptor: dynamicToolDescriptor },
  ] satisfies readonly PluginSlotDeclaration[];
}
