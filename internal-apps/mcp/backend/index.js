/**
 * internal-apps/mcp/backend/index.js — MCP app backend activation entry
 *
 * Registers all MCP API methods via BackendAppHost.
 * Delegates to the MCP connection manager factory.
 *
 * When compiled by compile-apps.mjs, esbuild bundles all dependencies
 * into a single self-contained apps/mcp/backend.cjs file.
 */

import { createMcpManager } from './lib/mcp-manager/index.js';
import { createMcpService } from './services/mcp.js';

/** @import { BackendAppHost } from '../../../../agent-type/app.ts' */

/**
 * Module-scoped manager reference — set during activate(),
 * used by deactivate() for cleanup.
 * @type {import('../lib/mcp-manager/index.js').McpManager | null}
 */
let _manager = null;

/**
 * Activate the MCP app backend.
 * Creates an isolated MCP manager scoped to the agent directory,
 * then registers all API methods.
 *
 * @param {BackendAppHost} host
 */
export function activate(host) {
  const agentDir = host.getAgentDir();
  if (!agentDir) {
    throw new Error('[mcp] Cannot activate MCP app: host.getAgentDir() returned null. ' +
      'The MCP app requires a project root to persist server configurations.');
  }

  const proxyConfig = host.getBackendConfig('proxy');
  const keyEncryption = host.getBackendConfig('keyEncryption');

  // Lazy resolver — terminal app may not be activated yet at this point.
  // Resolution happens when `stdio` transport actually needs a terminal session.
  const getTerminalService = () => host.services.resolve('terminal');

  const manager = createMcpManager(agentDir, proxyConfig, keyEncryption, getTerminalService);
  _manager = manager;
  const service = createMcpService(manager);

  // ── CRUD servers ─────────────────────────────────────────────────────────
  host.defineApi('listServers', async (_params) => service.getMcpServers());
  host.defineApi('addServer', async (params) => {
    const { name, url = '', transport = 'streamable-http', headers, includeTools, useProxy } = params || {};
    return service.addMcpServer({ name, url, transport, headers, includeTools, useProxy });
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

  // ── Resources ─────────────────────────────────────────────────────────────
  host.defineApi('listResources', async (params) => {
    const { server } = params || {};
    return service.listMcpResources({ server });
  });
  host.defineApi('listResourceTemplates', async (params) => {
    const { server } = params || {};
    return service.listMcpResourceTemplates({ server });
  });
  host.defineApi('readResource', async (params) => {
    const { server, uri } = params || {};
    return service.readMcpResource({ server, uri });
  });

  // ── Prompts ───────────────────────────────────────────────────────────────
  host.defineApi('listPrompts', async (params) => {
    const { server } = params || {};
    return service.listMcpPrompts({ server });
  });
  host.defineApi('getPrompt', async (params) => {
    const { server, name, arguments: args } = params || {};
    return service.getMcpPrompt({ server, name, arguments: args });
  });

  // ── Startup reconnect ─────────────────────────────────────────────────────
  // Terminal app may not be activated yet — poll until ready, then
  // reconnect all enabled servers.  Timeout falls through anyway
  // (non-stdio servers don't need the terminal service).

  const TERMINAL_WAIT_MS = 20_000;
  const TERMINAL_POLL_MS = 200;
  const maxTries = Math.ceil(TERMINAL_WAIT_MS / TERMINAL_POLL_MS);

  const doReconnect = () => {
    manager.startupReconnect().catch((err) => {
      console.warn('[mcp] startup reconnect failed:', err?.message ?? err);
    });
  };

  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    if (getTerminalService() || tries >= maxTries) {
      clearInterval(poll);
      doReconnect();
    }
  }, TERMINAL_POLL_MS);
}

/**
 * Deactivate hook — called by the app lifecycle when the app is
 * disabled or uninstalled.  Disconnects all MCP servers and clears
 * connection state.  Symmetric to activate(host).
 */
export function deactivate() {
  if (_manager) {
    _manager.shutdown();
    _manager = null;
  }
}
