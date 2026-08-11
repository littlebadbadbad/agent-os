/**
 * internal-apps/dynamic-tool/agent/activate.ts — Dynamic tool app activation entry
 */

import type { AgentAppHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createDynamicToolAppAdapter } from './appAdapter';
import { createDynamicToolset, getDynamicToolSlotDeclarations } from './toolSet';

export function activate(host: AgentAppHost): void {
  const adapter = createDynamicToolAppAdapter(host.apiClient);
  const toolSet = createDynamicToolset(adapter);
  const slots = getDynamicToolSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
