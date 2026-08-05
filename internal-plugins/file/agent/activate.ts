/**
 * internal-plugins/file/agent/activate.ts — File plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createFilePluginAdapter } from './pluginAdapter';
import { createFileToolSet, getFileSlotDeclarations } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createFilePluginAdapter(host.apiClient);
  const toolSet = createFileToolSet(adapter);
  const slots = getFileSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
