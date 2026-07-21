import type { AgentPluginHost } from '@agent-type';
import type { McpBridge } from './types';
import { createMcpPluginAdapter } from './pluginAdapter';
import { createMcpToolset } from './manager';

export function activate(host: AgentPluginHost<McpBridge>): void {
  const adapter = createMcpPluginAdapter(host.apiClient);
  const { toolSet, slotDeclarations, bridgeMethods } = createMcpToolset(adapter);
  host.registerToolSet(toolSet, slotDeclarations);
  Object.assign(host.bridge, bridgeMethods);
}
