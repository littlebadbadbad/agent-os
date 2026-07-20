/**
 * extensions/tool-state/agent/activate.ts — Tool State plugin activation entry
 */

import type { AgentPluginHost, ToolSet, PluginSlotDeclaration } from '@agent-type';
import { createToolStateToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createToolStateToolSet() as ToolSet & { readonly toolStateSlotDeclarations: readonly PluginSlotDeclaration[] };
  host.registerToolSet(toolSet, toolSet.toolStateSlotDeclarations);
}
