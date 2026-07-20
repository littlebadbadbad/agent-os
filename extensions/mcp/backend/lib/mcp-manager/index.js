/**
 * Backend MCP connection manager — plugin edition.
 *
 * Responsibilities:
 *   - Persist server configs to .agent/mcp-servers.json (survives restarts).
 *   - Maintain live MCP client connections (HTTP or SSE transport).
 *   - Return tool lists for each connected server.
 *   - Execute tool calls on behalf of the frontend agent.
 *
 * Why backend?  Browser fetch is subject to CORS; Node.js fetch is not.
 *
 * Proxy support:
 *   Each MCP server entry has a `useProxy` flag (default true).
 *   When true, connections route through the globally configured proxy.
 *   When false, the transport bypasses the proxy via undici's direct Agent.
 *
 * Factory pattern: createMcpManager(agentDir, proxyConfig) returns an isolated
 * instance scoped to the given agent directory.
 *
 * Transport implementations live in sibling files:
 *   http-transport.js  — MCP spec 2025-03-26 (HTTP + SSE fallback)
 *   sse-transport.js   — MCP spec 2024-11-05 (long-lived SSE + POST)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHttpClient } from './http-transport.js';
import { createSseClient } from './sse-transport.js';

// ── Logger ────────────────────────────────────────────────────────────────────

const log = {
  info:  (msg) => console.log(`[mcp] ${msg}`),
  warn:  (msg) => console.warn(`[mcp] ${msg}`),
  error: (msg, detail) => console.error(`[mcp] ${msg}${detail ? ': ' + detail : ''}`),
  ok:    (msg) => console.log(`[mcp] ${msg}`),
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an isolated MCP connection manager.
 *
 * @param {string} agentDir     Absolute path to the `.agent/` directory.
 *                              Config is stored at `join(agentDir, 'mcp-servers.json')`.
 * @param {object} [proxyCfg]   Proxy configuration from host.getBackendConfig('proxy').
 *                              Used to set the direct Agent's connect timeout.
 * @returns {McpManager}  An object with all CRUD and tool-execution methods.
 */
export function createMcpManager(agentDir, proxyCfg = null) {
  // Ensure .agent directory exists.
  try { mkdirSync(agentDir, { recursive: true }); } catch { /* ignore */ }

  const CONFIG_FILE = join(agentDir, 'mcp-servers.json');

  // ── Persistence ───────────────────────────────────────────────────────────

  function loadConfigs() {
    try {
      if (!existsSync(CONFIG_FILE)) return [];
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return [];
    }
  }

  function saveConfigs() {
    const serializable = [...configs.values()].map(
      ({ id, name, url, transport, headers, includeTools, useProxy, enabled }) =>
        ({ id, name, url, transport, headers, includeTools, useProxy, enabled }),
    );
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (err) {
      log.warn('failed to persist mcp-servers.json', err.message);
    }
  }

  // ── In-memory state ───────────────────────────────────────────────────────

  /** @type {Map<string, {id,name,url,transport,headers,includeTools,useProxy,enabled}>} */
  const configs = new Map();

  /** @type {Map<string, {listTools: ()=>Promise, callTool: (name,args)=>Promise<string>, close: ()=>void}>} */
  const clients = new Map();

  /** @type {Map<string, Array<{name,description,inputSchema}>>} */
  const toolsByServer = new Map();

  /** @type {Map<string, {status:'disconnected'|'connecting'|'connected'|'error', errorMsg?:string}>} */
  const statusByServer = new Map();

  // Hydrate configs from disk on creation.
  for (const cfg of loadConfigs()) {
    configs.set(cfg.name, cfg);
    statusByServer.set(cfg.name, { status: 'disconnected' });
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  async function connectServer(name) {
    const cfg = configs.get(name);
    if (!cfg) throw new Error(`MCP server "${name}" not registered.`);

    // Tear down any existing connection first.
    if (clients.has(name)) {
      try { clients.get(name).close(); } catch { /* ignore */ }
      clients.delete(name);
      toolsByServer.delete(name);
    }

    statusByServer.set(name, { status: 'connecting' });
    log.info(`connecting to MCP server "${name}" (${cfg.transport}) \u2192 ${cfg.url}`);

    const transportOpts = { useProxy: cfg.useProxy !== false };
    try {
      const client = cfg.transport === 'http'
        ? await createHttpClient(cfg.url, cfg.headers, transportOpts)
        : await createSseClient(cfg.url, cfg.headers, transportOpts);

      let tools = await client.listTools();
      if (cfg.includeTools?.length) {
        const allow = new Set(cfg.includeTools);
        tools = tools.filter((t) => allow.has(t.name));
      }

      clients.set(name, client);
      toolsByServer.set(name, tools);
      statusByServer.set(name, { status: 'connected' });
      log.ok(`"${name}" connected \u2014 ${tools.length} tool(s) available`);
    } catch (err) {
      clients.delete(name);
      toolsByServer.delete(name);
      statusByServer.set(name, { status: 'error', errorMsg: err.message });
      log.error(`"${name}" connection failed`, err.message);
      throw err;
    }
  }

  function disconnectServer(name) {
    if (clients.has(name)) {
      try { clients.get(name).close(); } catch { /* ignore */ }
      clients.delete(name);
      toolsByServer.delete(name);
    }
    statusByServer.set(name, { status: 'disconnected' });
    log.info(`"${name}" disconnected`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function listServers() {
    return [...configs.values()].map((cfg) => {
      const { status, errorMsg } = statusByServer.get(cfg.name) ?? { status: 'disconnected' };
      return {
        ...cfg,
        status,
        errorMsg,
        tools: toolsByServer.get(cfg.name) ?? [],
      };
    });
  }

  function getServer(name) {
    const cfg = configs.get(name);
    if (!cfg) return undefined;
    const { status, errorMsg } = statusByServer.get(name) ?? { status: 'disconnected' };
    return { ...cfg, status, errorMsg, tools: toolsByServer.get(name) ?? [] };
  }

  /**
   * Register a new MCP server config and connect immediately.
   * Throws if a server with the same name already exists.
   */
  async function addServer({ name, url, transport, headers, includeTools, useProxy, enabled = true }) {
    if (configs.has(name)) {
      throw new Error(`An MCP server named "${name}" is already registered.`);
    }
    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cfg = { id, name, url, transport, headers, includeTools, useProxy, enabled };
    configs.set(name, cfg);
    statusByServer.set(name, { status: 'disconnected' });
    saveConfigs();

    if (enabled) {
      await connectServer(name);
      saveConfigs(); // persist updated enabled state
    }
    return getServer(name);
  }

  function removeServer(name) {
    disconnectServer(name);
    configs.delete(name);
    statusByServer.delete(name);
    saveConfigs();
    log.info(`"${name}" removed`);
  }

  async function reconnectServer(name) {
    if (!configs.has(name)) throw new Error(`MCP server "${name}" not registered.`);
    await connectServer(name);
    // Mark as enabled in persisted config.
    const cfg = configs.get(name);
    cfg.enabled = true;
    saveConfigs();
    return getServer(name);
  }

  function disconnectServerByName(name) {
    disconnectServer(name);
    const cfg = configs.get(name);
    if (cfg) {
      cfg.enabled = false;
      saveConfigs();
    }
  }

  async function callTool(serverName, toolName, args) {
    const client = clients.get(serverName);
    if (!client) {
      throw new Error(
        `MCP server "${serverName}" is not connected. Use connect_mcp_server to connect first.`,
      );
    }
    return client.callTool(toolName, args);
  }

  // ── Return public interface ───────────────────────────────────────────────

  return {
    listServers,
    getServer,
    addServer,
    removeServer,
    reconnectServer,
    disconnectServerByName,
    callTool,
    /** Reconnect all servers that were enabled before restart. */
    async startupReconnect() {
      const toConnect = [...configs.values()].filter((c) => c.enabled);
      if (toConnect.length === 0) return;
      log.info(`reconnecting ${toConnect.length} MCP server(s)...`);
      const results = await Promise.allSettled(toConnect.map((c) => connectServer(c.name)));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      log.ok(`${ok}/${toConnect.length} MCP server(s) reconnected`);
    },
  };
}
