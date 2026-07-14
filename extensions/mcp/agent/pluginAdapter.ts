/**
 * extensions/mcp/agent/pluginAdapter.ts — McpAdapter factory
 *
 * Wraps a pre-bound PluginApiClient into the McpAdapter interface.
 * This is how the MCP plugin's ToolSet communicates with its backend
 * via host.apiClient.call(method, params) — no pluginId needed because
 * the apiClient is pre-bound at construction time.
 *
 * No classes — pure factory function.
 */

import type { McpAdapter, McpServerEntry } from './types';
import type { PluginApiClient } from '@agent-type';

/**
 * Creates an McpAdapter that delegates all calls to a backend plugin
 * via a pre-bound PluginApiClient.
 *
 * @param apiClient  A pre-bound PluginApiClient for the 'mcp' plugin.
 * @returns          An McpAdapter implementation.
 */
export function createMcpPluginAdapter(apiClient: PluginApiClient): McpAdapter {
  return {
    async listServers() {
      const result = await apiClient.call<{ servers: McpServerEntry[] }>('listServers');
      return result.servers;
    },

    async addServer(config) {
      return apiClient.call<McpServerEntry>('addServer', config);
    },

    async removeServer(name) {
      await apiClient.call('removeServer', { name });
    },

    async reconnectServer(name) {
      await apiClient.call('reconnectServer', { name });
    },

    async disconnectServer(name) {
      await apiClient.call('disconnectServer', { name });
    },

    async executeTool(server, tool, args, sessionId, signal) {
      // signal is handled by the transport layer; forward sessionId if present
      const params: Record<string, unknown> = { server, tool, args };
      if (sessionId) params.sessionId = sessionId;
      const result = await apiClient.call<{ result: unknown }>('executeTool', params);
      return result.result;
    },
  };
}
