/**
 * extensions/git/agent/activate.ts — Git plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createGitPluginAdapter } from './pluginAdapter';
import { createGitToolSet, getGitSlotDeclarations } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createGitPluginAdapter(host.apiClient);
  const toolSet = createGitToolSet(adapter);
  const slots = getGitSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
