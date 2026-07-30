/**
 * extensions/mcp/agent/pluginAdapter.ts — McpAdapter factory
 *
 * Wraps a pre-bound PluginApiClient into the McpAdapter interface.
 * This is how the MCP plugin's ToolSet communicates with its backend
 * via host.apiClient.call(method, params).
 */

import type { McpAdapter, McpServerEntry, McpServerConfig } from './types';
import type { ToolCallResult } from './protocol';
import type { PluginApiClient } from '@agent-type';

interface ListServersResponse {
  readonly servers: readonly McpServerEntry[];
}

interface ExecuteToolResponse {
  readonly result: ToolCallResult;
}

/**
 * Creates an McpAdapter that delegates all calls to a backend plugin
 * via a pre-bound PluginApiClient.
 */
export function createMcpPluginAdapter(apiClient: PluginApiClient): McpAdapter {
  return {
    async listServers() {
      const res = await apiClient.call<ListServersResponse>('listServers');
      return res.servers;
    },

    async addServer(config: McpServerConfig) {
      return apiClient.call<McpServerEntry>('addServer', { ...config } as Record<string, unknown>);
    },

    async removeServer(name: string) {
      await apiClient.call('removeServer', { name });
    },

    async reconnectServer(name: string) {
      await apiClient.call('reconnectServer', { name });
    },

    async disconnectServer(name: string) {
      await apiClient.call('disconnectServer', { name });
    },

    async executeTool(
      serverName: string,
      toolName: string,
      args: Record<string, unknown>,
      sessionId: string,
      _signal: AbortSignal,
    ) {
      const res = await apiClient.call<ExecuteToolResponse>('executeTool', {
        server: serverName,
        tool: toolName,
        args,
        sessionId,
      });
      return res.result;
    },
  };
}
