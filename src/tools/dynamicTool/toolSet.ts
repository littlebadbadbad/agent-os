/**
 * toolSet.ts — Dynamic tool ToolSet
 *
 * Composes proxy store + tool CRUD tools + module tools + dep tools into a
 * single ToolSet that can be registered on any number of agents.
 *
 * Replaces the monolithic manager.ts with four focused modules:
 *   proxy.ts      — proxy factory + proxy store
 *   toolTools.ts  — create/list/update/delete tool meta-tools
 *   moduleTools.ts — module CRUD meta-tools
 *   depTools.ts   — npm dep management meta-tools
 *
 * Usage
 * ─────
 * const dynamicToolset = createDynamicToolset(
 *   createHttpDynamicToolAdapter({ baseUrl: '/api' }),
 * );
 * agent.registerToolSet(dynamicToolset);
 */

import type { ToolSet, AgentQueryFns, AgentClientLike, SystemPromptContext, ToolSetContext } from '@agent-type';
import type { DynamicToolAdapter } from './types';
import { createProxyStore } from './proxy';
import { createToolCrudTools } from './toolTools';
import { createModuleTools } from './moduleTools';
import { createDepTools } from './depTools';

// ── System prompt ─────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `\
## Dynamic Tools

You can create, update and delete backend tools (Node.js ESM modules) or frontend
tools (inline JavaScript) at any time using the meta-tools below.

### Creating a backend tool
1. Call \`create_tool\` with \`runtime: "backend"\`.
2. The \`implementation\` field must be a complete ESM module that exports:
   \`\`\`js
   export async function run(args, context) { /* … */ }
   \`\`\`
3. You may import any package that has been installed via \`install_tool_deps\`.
4. You may import shared utility modules via \`import { x } from '#modules/name'\`.

### Creating a frontend tool
1. Call \`create_tool\` with \`runtime: "frontend"\`.
2. The \`implementation\` field is a function body (no wrapper) that has access
   to \`args\` and \`context\` (the full ToolExecutionContext).

Always call \`list_dynamic_tools\` before creating — a tool with that name may
already exist.`;

const MODULES_SYSTEM_PROMPT = `\
## Shared Modules

Reusable utility code can be extracted into shared modules and imported by any
backend tool:

\`\`\`js
import { myHelper } from '#modules/my-utils';
\`\`\`

- Use kebab-case names (e.g. \`"string-utils"\`, \`"http-client"\`).
- Modules must contain at least one \`export\` statement.
- Call \`list_modules\` before \`create_module\` — prefer \`update_module\`
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

Call \`list_tool_deps\` first — the package may already be installed.`;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the dynamic-tool ToolSet.
 *
 * @param adapter  Backend adapter — use `createHttpDynamicToolAdapter` for production.
 */
export function createDynamicToolset(adapter: DynamicToolAdapter): ToolSet {
  const proxyStore = createProxyStore(adapter);

  const toolCrudTools  = createToolCrudTools(adapter, proxyStore.register, proxyStore.unregister);
  const moduleToolsArr = createModuleTools(adapter);
  const depToolsArr    = createDepTools(adapter);

  function buildTools() {
    return [...toolCrudTools, ...moduleToolsArr, ...depToolsArr] as const;
  }

  const tools = buildTools();

  // Startup re-hydration: register proxies for tools that already exist.
  // Errors are swallowed — backend may be temporarily unavailable at startup.
  adapter
    .listTools()
    .then((entries) => {
      for (const entry of entries) proxyStore.register(entry);
    })
    .catch((err: unknown) => {
      console.warn('[dynamicToolset] startup hydration failed:', (err as Error)?.message ?? err);
    });

  return {
    name: 'dynamic-tools',
    description: 'Manages dynamically created agent tools, shared modules, and npm dependencies.',
    tools,
    coreTools: ['create_tool', 'update_tool', 'list_dynamic_tools', 'create_module', 'install_tool_deps'],

    onAttach(agent: AgentQueryFns): (() => void) | void {
      return proxyStore.buildOnAttach(agent as AgentClientLike);
    },

    onGetSystemPrompt(_ctx: ToolSetContext, _promptCtx: SystemPromptContext): string {
      return [BASE_SYSTEM_PROMPT, MODULES_SYSTEM_PROMPT, DEPS_SYSTEM_PROMPT].join('\n\n');
    },
  };
}
