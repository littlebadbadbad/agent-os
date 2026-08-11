/**
 * internal-apps/plan/agent/activate.ts — Plan app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the plan extension is activated.
 *
 * The app receives an AgentAppHost and registers its ToolSet.
 */

import type { AgentAppHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createPlanToolSet, getPlanSlotDeclarations } from './toolSet';

/**
 * Activate the plan app.
 *
 * Builds the plan ToolSet and registers it on the agent.
 *
 * @param host  The AgentAppHost for this app.
 */
export function activate(host: AgentAppHost): void {
  const toolSet = createPlanToolSet();
  const slots = getPlanSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
