/**
 * internal-plugins/plan/agent/activate.ts — Plan plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the plan extension is activated.
 *
 * The plugin receives an AgentPluginHost and registers its ToolSet.
 */

import type { AgentPluginHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createPlanToolSet, getPlanSlotDeclarations } from './toolSet';

/**
 * Activate the plan plugin.
 *
 * Builds the plan ToolSet and registers it on the agent.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  const toolSet = createPlanToolSet();
  const slots = getPlanSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
