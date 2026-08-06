/**
 * Backend MCP Manager — plugin edition.
 *
 * Responsibilities:
 *   - Persist server configs to `.agent/mcp-servers.json`.
 *   - Maintain live MCP client connections (streamable-http / legacy-sse / stdio).
 *   - Return tool lists and server status.
 *   - Execute tool calls on behalf of the frontend agent.
 *
 * Architecture:
 *   config-store.js   — persistence layer
 *   connection.js     — connection lifecycle + transport dispatch
 *   index.js          — orchestrator (this file)
 *
 * Each transport is a standalone module under transports/:
 *   streamable-http.js  — MCP 2025-06-18 (single endpoint POST+GET, negotiable down to 2025-03-26)
 *   legacy-sse.js       — MCP 2024-11-05 (deprecated, separate SSE+POST)
 *   stdio.js            — subprocess stdin/stdout
 *
 * Factory: createMcpManager(agentDir, proxyConfig) returns an isolated instance.
 */

import { createConfigStore } from './config-store.js';
import { createCryptoConfigStore } from './crypto-config-store.js';
import { createConnectionManager } from './connection.js';

/**
 * @typedef {import('./config-store.js').ServerConfig} ServerConfig
 * @typedef {import('./connection.js').ResourceDef} ResourceDef
 * @typedef {import('./connection.js').ResourceTemplateDef} ResourceTemplateDef
 * @typedef {import('./connection.js').ResourceReadResult} ResourceReadResult
 * @typedef {import('./connection.js').PromptDef} PromptDef
 * @typedef {import('./connection.js').PromptGetResult} PromptGetResult
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {object} inputSchema
 * @typedef {object} ServerEntry
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {'streamable-http'|'legacy-sse'|'stdio'} transport
 * @property {Record<string,string>} headers
 * @property {readonly string[]} includeTools
 * @property {boolean} enabled
 * @property {boolean} useProxy
 * @property {'disconnected'|'connecting'|'connected'|'error'} status
 * @property {string} errorMsg
 * @property {readonly ToolDef[]} tools
 * @property {readonly ResourceDef[]} resources
 * @property {readonly ResourceTemplateDef[]} resourceTemplates
 * @property {readonly PromptDef[]} prompts
 * @typedef {object} AddServerInput
 * @property {string} name
 * @property {string} url
 * @property {'streamable-http'|'legacy-sse'|'stdio'} [transport]
 * @property {Record<string,string>} [headers]
 * @property {string[]} [includeTools]
 * @property {boolean} [useProxy]
 * @property {boolean} [enabled]
 * @typedef {object} McpManager
 * @property {() => readonly ServerEntry[]} listServers
 * @property {(name:string) => ServerEntry|undefined} getServer
 * @property {(input:AddServerInput) => Promise<ServerEntry>} addServer
 * @property {(name:string) => void} removeServer
 * @property {(name:string) => Promise<ServerEntry>} reconnectServer
 * @property {(name:string) => void} disconnectServerByName
 * @property {(serverName:string, toolName:string, args:Record<string,unknown>) => Promise<unknown>} callTool
 * @property {(serverName:string) => Promise<readonly ResourceDef[]>} listResources
 * @property {(serverName:string) => Promise<readonly ResourceTemplateDef[]>} listResourceTemplates
 * @property {(serverName:string, uri:string) => Promise<ResourceReadResult>} readResource
 * @property {(serverName:string) => Promise<readonly PromptDef[]>} listPrompts
 * @property {(serverName:string, promptName:string, args?:Record<string,string>) => Promise<PromptGetResult>} getPrompt
 * @property {() => void} shutdown
 * @property {() => Promise<void>} startupReconnect
 */

// ── Logger ────────────────────────────────────────────────────────────────────

const log = {
  info: (msg) => console.log(`[mcp] ${msg}`),
  error: (msg, detail) => console.error(`[mcp] ${msg}${detail ? ': ' + detail : ''}`),
  ok: (msg) => console.log(`[mcp] ${msg}`),
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Crypto operations for at-rest encryption (optional).
 * @typedef {object} CryptoOps
 * @property {(plaintext:string) => string} encrypt
 * @property {(encoded:string) => string|null} decrypt
 */

/**
 * Create an isolated MCP connection manager.
 * @param {string} agentDir
 * @param {object|null} proxyCfg
 * @param {CryptoOps|null} [cryptoOps]
 * @param {() => (import('@agent-type/services').TerminalService | undefined)} [getTerminalService]
 * @returns {McpManager}
 */
export function createMcpManager(agentDir, proxyCfg = null, cryptoOps = null, getTerminalService = undefined) {
  const plainStore = createConfigStore(agentDir);
  const configs = createCryptoConfigStore(plainStore, cryptoOps);
  const connections = createConnectionManager(proxyCfg, getTerminalService);

  /** @type {Map<string, {status:'disconnected'|'connecting'|'connected'|'error', errorMsg:string}>} */
  const statusByServer  = new Map();

  /** @type {Map<string, readonly ResourceDef[]>} */
  const resourcesByServer = new Map();

  /** @type {Map<string, readonly ResourceTemplateDef[]>} */
  const resourceTemplatesByServer = new Map();

  /** @type {Map<string, readonly PromptDef[]>} */
  const promptsByServer = new Map();

  for (const cfg of configs.getAll()) {
    statusByServer.set(cfg.name, { status: 'disconnected', errorMsg: '' });
  }

  // ── Entry Builder ──────────────────────────────────────────────────────

  /** @param {ServerConfig} cfg @returns {ServerEntry} */
  function buildEntry(cfg) {
    const st = statusByServer.get(cfg.name) ?? { status: 'disconnected', errorMsg: '' };
    const isConnected = st.status === 'connected';
    return {
      id: cfg.id,
      name: cfg.name,
      url: cfg.url,
      transport: cfg.transport,
      headers: cfg.headers ?? {},
      includeTools: cfg.includeTools ?? [],
      enabled: cfg.enabled,
      useProxy: cfg.useProxy ?? false,
      status: st.status,
      errorMsg: st.errorMsg,
      tools: connections.getTools(cfg.name),
      resources: isConnected ? resourcesByServer.get(cfg.name) ?? [] : [],
      resourceTemplates: isConnected ? resourceTemplatesByServer.get(cfg.name) ?? [] : [],
      prompts: isConnected ? promptsByServer.get(cfg.name) ?? [] : [],
    };
  }

  // ── Connection Lifecycle ───────────────────────────────────────────────

  /** @param {string} name */
  async function connectServer(name) {
    const cfg = configs.get(name);
    if (!cfg) throw new Error(`MCP server "${name}" not registered.`);

    statusByServer.set(name, { status: 'connecting', errorMsg: '' });

    try {
      await connections.connect(cfg);
      statusByServer.set(name, { status: 'connected', errorMsg: '' });

      // Fetch resources and prompts in the background — don't fail the
      // connection if the server doesn't support them.
      try {
        const [resources, templates, prompts] = await Promise.all([
          connections.listResources(name).catch(() => []),
          connections.listResourceTemplates(name).catch(() => []),
          connections.listPrompts(name).catch(() => []),
        ]);
        resourcesByServer.set(name, resources);
        resourceTemplatesByServer.set(name, templates);
        promptsByServer.set(name, prompts);
      } catch {
        // Server doesn't support resources/prompts — leave caches empty.
      }
    } catch (err) {
      statusByServer.set(name, { status: 'error', errorMsg: err.message });
      throw err;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  function listServers() {
    return configs.getAll().map(buildEntry);
  }

  /** @param {string} name @returns {ServerEntry|undefined} */
  function getServer(name) {
    const cfg = configs.get(name);
    return cfg ? buildEntry(cfg) : undefined;
  }

  /** @param {AddServerInput} input @returns {Promise<ServerEntry>} */
  async function addServer(input) {
    if (!input.name) throw new Error('name is required');
    if (configs.get(input.name)) {
      throw new Error(`An MCP server named "${input.name}" is already registered.`);
    }

    const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    /** @type {ServerConfig} */
    const cfg = {
      id,
      name: input.name,
      url: input.url ?? '',
      transport: input.transport ?? 'streamable-http',
      headers: input.headers,
      includeTools: input.includeTools,
      useProxy: input.useProxy ?? false,
      enabled: input.enabled ?? true,
    };

    configs.save(cfg);
    statusByServer.set(input.name, { status: 'disconnected', errorMsg: '' });

    if (cfg.enabled) {
      await connectServer(input.name);
    }

    return buildEntry(cfg);
  }

  /** @param {string} name */
  function removeServer(name) {
    connections.disconnect(name);
    configs.remove(name);
    statusByServer.delete(name);
    resourcesByServer.delete(name);
    resourceTemplatesByServer.delete(name);
    promptsByServer.delete(name);
    log.info(`"${name}" removed`);
  }

  /** @param {string} name @returns {Promise<ServerEntry>} */
  async function reconnectServer(name) {
    const cfg = configs.get(name);
    if (!cfg) throw new Error(`MCP server "${name}" not registered.`);
    await connectServer(name);
    cfg.enabled = true;
    configs.save(cfg);
    return buildEntry(cfg);
  }

  /** @param {string} name */
  function disconnectServerByName(name) {
    connections.disconnect(name);
    statusByServer.set(name, { status: 'disconnected', errorMsg: '' });
    resourcesByServer.delete(name);
    resourceTemplatesByServer.delete(name);
    promptsByServer.delete(name);
    const cfg = configs.get(name);
    if (cfg) {
      cfg.enabled = false;
      configs.save(cfg);
    }
  }

  /** @param {string} serverName @param {string} toolName @param {Record<string,unknown>} args */
  async function callTool(serverName, toolName, args) {
    return connections.callTool(serverName, toolName, args);
  }

  /** @param {string} serverName */
  async function listResources(serverName) {
    return connections.listResources(serverName);
  }

  /** @param {string} serverName */
  async function listResourceTemplates(serverName) {
    return connections.listResourceTemplates(serverName);
  }

  /** @param {string} serverName @param {string} uri */
  async function readResource(serverName, uri) {
    return connections.readResource(serverName, uri);
  }

  /** @param {string} serverName */
  async function listPrompts(serverName) {
    return connections.listPrompts(serverName);
  }

  /** @param {string} serverName @param {string} promptName @param {Record<string,string>} [args] */
  async function getPrompt(serverName, promptName, args) {
    return connections.getPrompt(serverName, promptName, args);
  }

  function shutdown() {
    connections.shutdown();
    statusByServer.clear();
    resourcesByServer.clear();
    resourceTemplatesByServer.clear();
    promptsByServer.clear();
    log.info('MCP manager shut down');
  }

  async function startupReconnect() {
    const toConnect = configs.getAll().filter((c) => c.enabled);
    if (toConnect.length === 0) return;
    log.info(`reconnecting ${toConnect.length} MCP server(s)...`);
    const results = await Promise.allSettled(toConnect.map((c) => connectServer(c.name)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    log.ok(`${ok}/${toConnect.length} MCP server(s) reconnected`);
  }

  return {
    listServers,
    getServer,
    addServer,
    removeServer,
    reconnectServer,
    disconnectServerByName,
    callTool,
    listResources,
    listResourceTemplates,
    readResource,
    listPrompts,
    getPrompt,
    shutdown,
    startupReconnect,
  };
}
