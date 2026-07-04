/**
 * Backend MCP connection manager.
 *
 * Responsibilities:
 *   - Persist server configs to .agent/mcp-servers.json (survives restarts).
 *   - Maintain live MCP client connections (HTTP or SSE transport).
 *   - Return tool lists for each connected server.
 *   - Execute tool calls on behalf of the frontend agent.
 *
 * Why backend?  Browser fetch is subject to CORS; Node.js fetch is not.
 *
 * Transport implementations live in sibling files:
 *   http-transport.js  — MCP spec 2025-03-26 (HTTP + SSE fallback)
 *   sse-transport.js   — MCP spec 2024-11-05 (long-lived SSE + POST)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger.js';
import { AGENT_DIR } from '../paths.js';
import { createHttpClient } from './http-transport.js';
import { createSseClient } from './sse-transport.js';

const log = createLogger('mcp');

const CONFIG_FILE = join(AGENT_DIR, 'mcp-servers.json');

// AGENT_DIR is created eagerly by paths.js — no mkdirSync needed here.

// ── Persistence ───────────────────────────────────────────────────────────────

/** Fields that survive a restart. Runtime status/tools are re-derived on connect. */
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
    ({ id, name, url, transport, headers, includeTools, enabled }) =>
      ({ id, name, url, transport, headers, includeTools, enabled }),
  );
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(serializable, null, 2), 'utf8');
  } catch (err) {
    log.warn('failed to persist mcp-servers.json', err.message);
  }
}

// ── In-memory state ───────────────────────────────────────────────────────────

/** @type {Map<string, {id,name,url,transport,headers,includeTools,enabled}>} */
const configs = new Map();

/** @type {Map<string, {listTools: ()=>Promise, callTool: (name,args)=>Promise<string>, close: ()=>void}>} */
const clients = new Map();

/** @type {Map<string, Array<{name,description,inputSchema}>>} */
const toolsByServer = new Map();

/** @type {Map<string, {status:'disconnected'|'connecting'|'connected'|'error', errorMsg?:string}>} */
const statusByServer = new Map();

// Hydrate configs from disk on module load.
for (const cfg of loadConfigs()) {
  configs.set(cfg.name, cfg);
  statusByServer.set(cfg.name, { status: 'disconnected' });
}

// ── Connection lifecycle ──────────────────────────────────────────────────────

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
  log.info(`connecting to MCP server "${name}" (${cfg.transport}) → ${cfg.url}`);

  try {
    const client = cfg.transport === 'http'
      ? await createHttpClient(cfg.url, cfg.headers)
      : await createSseClient(cfg.url, cfg.headers);

    let tools = await client.listTools();
    if (cfg.includeTools?.length) {
      const allow = new Set(cfg.includeTools);
      tools = tools.filter((t) => allow.has(t.name));
    }

    clients.set(name, client);
    toolsByServer.set(name, tools);
    statusByServer.set(name, { status: 'connected' });
    log.ok(`"${name}" connected — ${tools.length} tool(s) available`);
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

// ── Public API ────────────────────────────────────────────────────────────────

export function listServers() {
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

export function getServer(name) {
  const cfg = configs.get(name);
  if (!cfg) return undefined;
  const { status, errorMsg } = statusByServer.get(name) ?? { status: 'disconnected' };
  return { ...cfg, status, errorMsg, tools: toolsByServer.get(name) ?? [] };
}

/**
 * Register a new MCP server config and connect immediately.
 * Throws if a server with the same name already exists.
 */
export async function addServer({ name, url, transport, headers, includeTools, enabled = true }) {
  if (configs.has(name)) {
    throw new Error(`An MCP server named "${name}" is already registered.`);
  }
  const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cfg = { id, name, url, transport, headers, includeTools, enabled };
  configs.set(name, cfg);
  statusByServer.set(name, { status: 'disconnected' });
  saveConfigs();

  if (enabled) {
    await connectServer(name);
    saveConfigs(); // persist updated enabled state
  }
  return getServer(name);
}

export function removeServer(name) {
  disconnectServer(name);
  configs.delete(name);
  statusByServer.delete(name);
  saveConfigs();
  log.info(`"${name}" removed`);
}

export async function reconnectServer(name) {
  if (!configs.has(name)) throw new Error(`MCP server "${name}" not registered.`);
  await connectServer(name);
  // Mark as enabled in persisted config.
  const cfg = configs.get(name);
  cfg.enabled = true;
  saveConfigs();
  return getServer(name);
}

export function disconnectServerByName(name) {
  disconnectServer(name);
  const cfg = configs.get(name);
  if (cfg) {
    cfg.enabled = false;
    saveConfigs();
  }
}

export async function callTool(serverName, toolName, args) {
  const client = clients.get(serverName);
  if (!client) {
    throw new Error(
      `MCP server "${serverName}" is not connected. Use connect_mcp_server to connect first.`,
    );
  }
  return client.callTool(toolName, args);
}

/**
 * Called once on backend startup — reconnects all servers that were enabled at
 * last shutdown.
 */
export async function startupReconnect() {
  const enabled = [...configs.values()].filter((c) => c.enabled);
  if (enabled.length === 0) return;
  log.info(`startup: reconnecting ${enabled.length} MCP server(s)…`);
  await Promise.allSettled(enabled.map((cfg) => connectServer(cfg.name)));
}
