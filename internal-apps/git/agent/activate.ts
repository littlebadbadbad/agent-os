/**
 * internal-apps/git/agent/activate.ts — Git app activation entry
 */

import type { AgentAppHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createGitAppAdapter } from './appAdapter';
import { createGitToolSet, getGitSlotDeclarations } from './toolSet';

export function activate(host: AgentAppHost): void {
  const adapter = createGitAppAdapter(host.apiClient);
  const toolSet = createGitToolSet(adapter);
  const slots = getGitSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
