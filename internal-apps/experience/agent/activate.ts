/**
 * internal-apps/experience/agent/activate.ts — Experience app activation entry
 *
 * Loaded by the app runtime when the experience extension is activated.
 * Registers the experience ToolSet on the agent.
 */

import type { AgentAppHost, ToolSet, SlotDeclaration } from '@agent-type';
import { createExperienceToolSet } from './toolSet';

export function activate(host: AgentAppHost): void {
  const toolSet = createExperienceToolSet() as ToolSet & { readonly slotDeclarations: readonly SlotDeclaration[] };
  host.registerToolSet(toolSet, toolSet.slotDeclarations);
}
