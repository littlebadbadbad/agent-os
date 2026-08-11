import type { AgentAppHost } from '@agent-type';
import type { McpBridge } from './types';
import { createMcpAppAdapter } from './appAdapter';
import { createMcpToolset } from './manager';

export function activate(host: AgentAppHost<McpBridge>): void {
  const adapter = createMcpAppAdapter(host.apiClient);
  const { toolSet, slotDeclarations, bridgeMethods } = createMcpToolset(adapter);
  host.registerToolSet(toolSet, slotDeclarations);
  Object.assign(host.bridge, bridgeMethods);
}
