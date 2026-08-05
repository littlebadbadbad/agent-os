/**
 * internal-plugins/dynamic-tool/agent/activate.ts — Dynamic tool plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createDynamicToolPluginAdapter } from './pluginAdapter';
import { createDynamicToolset, getDynamicToolSlotDeclarations } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createDynamicToolPluginAdapter(host.apiClient);
  const toolSet = createDynamicToolset(adapter);
  const slots = getDynamicToolSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
