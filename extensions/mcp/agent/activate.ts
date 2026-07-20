import type { AgentPluginHost } from '@agent-type';
import { createMcpPluginAdapter } from './pluginAdapter';
import { createMcpToolset } from './manager';

export function activate(host: AgentPluginHost): void {
  const adapter = createMcpPluginAdapter(host.apiClient);
  const { toolSet, slotDeclarations, agentApis } = createMcpToolset(adapter);
  host.registerToolSet(toolSet, slotDeclarations);
  for (const [method, handler] of agentApis) {
    host.registerAgentApi(method, handler);
  }
}
