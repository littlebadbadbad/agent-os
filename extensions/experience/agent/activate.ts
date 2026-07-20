/**
 * extensions/experience/agent/activate.ts — Experience plugin activation entry
 *
 * Loaded by the plugin runtime when the experience extension is activated.
 * Registers the experience ToolSet on the agent.
 */

import type { AgentPluginHost, ToolSet, PluginSlotDeclaration } from '@agent-type';
import { createExperienceToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createExperienceToolSet() as ToolSet & { readonly slotDeclarations: readonly PluginSlotDeclaration[] };
  host.registerToolSet(toolSet, toolSet.slotDeclarations);
}
