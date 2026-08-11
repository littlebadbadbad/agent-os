/**
 * internal-apps/file/agent/activate.ts — File app activation entry
 */

import type { AgentAppHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createFileAppAdapter } from './appAdapter';
import { createFileToolSet, getFileSlotDeclarations } from './toolSet';

export function activate(host: AgentAppHost): void {
  const adapter = createFileAppAdapter(host.apiClient);
  const toolSet = createFileToolSet(adapter);
  const slots = getFileSlotDeclarations(resolveToolSetTools(toolSet).map((t) => t.name));
  host.registerToolSet(toolSet, slots);
}
