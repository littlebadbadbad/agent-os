/**
 * extensions/mcp/backend/index.js — MCP plugin backend activation entry
 *
 * Registers all MCP API methods via BackendPluginHost.
 * Delegates to the MCP connection manager factory.
 *
 * When compiled by compile-plugins.mjs, esbuild bundles all dependencies
 * into a single self-contained plugins/mcp/backend.cjs file.
 */

import { createMcpManager } from './lib/mcp-manager/index.js';
import { createMcpService } from './services/mcp.js';

/**
 * Activate the MCP plugin backend.
 * Creates an isolated MCP manager scoped to the agent directory,
 * then registers all API methods.
 *
 * @param {import('../../../../agent-type/plugin.ts').BackendPluginHost} host
 */
export function activate(host) {
  const agentDir = host.getAgentDir();
  if (!agentDir) {
    throw new Error('[mcp] Cannot activate MCP plugin: host.getAgentDir() returned null. ' +
      'The MCP plugin requires a project root to persist server configurations.');
  }

  const manager = createMcpManager(agentDir);
  const service = createMcpService(manager);

  // ── CRUD servers ─────────────────────────────────────────────────────────
  host.defineApi('listServers', async (_params) => service.getMcpServers());
  host.defineApi('addServer', async (params) => {
    const { name, url = '', transport = 'http', headers, includeTools } = params || {};
    return service.addMcpServer({ name, url, transport, headers, includeTools });
  });
  host.defineApi('removeServer', async (params) => {
    const { name } = params || {};
    service.removeMcpServer({ name });
    return { ok: true };
  });
  host.defineApi('reconnectServer', async (params) => {
    const { name } = params || {};
    return service.reconnectMcpServer({ name });
  });
  host.defineApi('disconnectServer', async (params) => {
    const { name } = params || {};
    service.disconnectMcpServer({ name });
    return { ok: true };
  });

  // ── Tool execution ────────────────────────────────────────────────────────
  host.defineApi('executeTool', async (params) => {
    const { server, tool, args, sessionId } = params || {};
    return service.executeMcpTool({ server, tool, args, sessionId });
  });

  // ── Startup reconnect ─────────────────────────────────────────────────────
  manager.startupReconnect().catch((err) => {
    console.warn('[mcp] startup reconnect failed:', err?.message ?? err);
  });
}
