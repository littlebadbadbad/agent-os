/**
 * src/tools/mcp/ipcAdapter.ts — Electron IPC adapter for MCP server management
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 */

import type { McpAdapter, McpServerEntry } from './types';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcMcpAdapterConfig = Record<string, never>;

// ── IPC MCP adapter factory ──────────────────────────────────────────────────

/**
 * Create an `McpAdapter` that delegates all MCP management to the Agent SDK
 * backend via Electron IPC instead of HTTP REST.
 *
 * @example
 * ```ts
 * const adapter = createIpcMcpAdapter();
 * const mcpManager = createMcpManager(agents, adapter);
 * ```
 */
export function createIpcMcpAdapter(
  _config: IpcMcpAdapterConfig = {},
): McpAdapter {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcMcpAdapter: window.electronAPI.invoke is not available');
  }

  return {
    async listServers() {
      const data = await invoke('mcp:list') as { servers: McpServerEntry[] };
      return data.servers ?? [];
    },

    async addServer(config) {
      const data = await invoke('mcp:add', {
        name: config.name,
        url: config.url,
        transport: config.transport,
        headers: config.headers,
        includeTools: config.includeTools,
      }) as { server: McpServerEntry };
      return data.server;
    },

    async removeServer(name) {
      await invoke('mcp:remove', { name });
    },

    async reconnectServer(name) {
      await invoke('mcp:reconnect', { name });
    },

    async disconnectServer(name) {
      await invoke('mcp:disconnect', { name });
    },

    async executeTool(server, tool, args, sessionId?, signal?) {
      const data = await invoke('mcp:execute', { server, tool, args, sessionId }) as { result: unknown };
      return data.result;
    },
  };
}
