/**
 * extensions/dynamic-tool/agent/toolSet.ts — Dynamic tool ToolSet
 */

import type { ToolSet, AgentQueryFns, AgentClientLike, SystemPromptContext, ToolSetContext, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import type { DynamicToolAdapter } from './types';
import { createProxyStore } from './proxy';
import { createToolCrudTools } from './toolTools';
import { createModuleTools } from './moduleTools';
import { createDepTools } from './depTools';

const BASE_SYSTEM_PROMPT = `\
## Dynamic Tools

You can create, update and delete backend tools (Node.js ESM modules) or frontend
tools (inline JavaScript) at any time using the meta-tools below.

### Creating a backend tool
1. Call \`create_tool\` with \`runtime: "backend"\`.
2. The \`implementation\` field must be a complete ESM module that exports:
   \`\`\`js
   export async function run(args, context) { /* \u2026 */ }
   \`\`\`
3. You may import any package that has been installed via \`install_tool_deps\`.
4. You may import shared utility modules via \`import { x } from '#modules/name'\`.

### Creating a frontend tool
1. Call \`create_tool\` with \`runtime: "frontend"\`.
2. The \`implementation\` field is a function body (no wrapper) that has access
   to \`args\` and \`context\` (the full ToolExecutionContext).

Always call \`list_dynamic_tools\` before creating \u2014 a tool with that name may already exist.`;

const MODULES_SYSTEM_PROMPT = `\
## Shared Modules

Reusable utility code can be extracted into shared modules and imported by any
backend tool:

\`\`\`js
import { myHelper } from '#modules/my-utils';
\`\`\`

- Use kebab-case names (e.g. "string-utils", "http-client").
- Modules must contain at least one \`export\` statement.
- Call \`list_modules\` before \`create_module\` \u2014 prefer \`update_module\`
  over creating near-duplicates.`;

const DEPS_SYSTEM_PROMPT = `\
## Third-party npm Dependencies

Install packages from npm into the tool-scripts scope:
\`\`\`
install_tool_deps(["axios", "date-fns@3", "@types/node"])
\`\`\`

After installation, import normally in backend tool scripts:
\`\`\`js
import axios from 'axios';
\`\`\`

Call \`list_tool_deps\` first \u2014 the package may already be installed.`;

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
      return [BASE_SYSTEM_PROMPT, MODULES_SYSTEM_PROMPT, DEPS_SYSTEM_PROMPT].join('\n\n');
    },

    onGetSymbolState: (_ctx: ToolSetContext) => ({
      type: 'dynamic-tool' as const,
      slots: [
        { type: 'toolCard' as const, toolNames: tools.map((t) => t.name) },
        { type: 'compactToolCard' as const, toolNames: tools.map((t) => t.name), getDescriptor: dynamicToolDescriptor },
      ] satisfies readonly PluginSlotDeclaration[],
    }),
  };
}
