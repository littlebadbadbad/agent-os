/**
 * extensions/mcp/backend/services/mcp.js — MCP-server business API
 *
 * One function per API method registered in backend/index.js.
 * ALL business logic lives in the mcp-manager library; this file
 * just wraps it in the shape expected by the activation entry.
 */

/** @import { McpManager } from '../lib/mcp-manager/index.js' */

export function createMcpService(manager) {
  return {
    getMcpServers() {
      return { servers: manager.listServers() };
    },

    async addMcpServer({ name, url, transport, headers, includeTools }) {
      if (!name) throw new Error('name is required');
      const server = await manager.addServer({ name, url, transport, headers, includeTools });
      return { server };
    },

    removeMcpServer({ name }) {
      if (!name) throw new Error('name is required');
      manager.removeServer(name);
      return { removed: name };
    },

    async reconnectMcpServer({ name }) {
      if (!name) throw new Error('name is required');
      const server = await manager.reconnectServer(name);
      return { server };
    },

    disconnectMcpServer({ name }) {
      if (!name) throw new Error('name is required');
      manager.disconnectServerByName(name);
      return { disconnected: name };
    },

    async executeMcpTool({ server, tool, args, sessionId }) {
      if (!server) throw new Error('server is required');
      if (!tool) throw new Error('tool is required');
      const result = await manager.callTool(server, tool, args, sessionId);
      return { result };
    },
  };
}
