/**
 * backend/lib/services/mcp.js — MCP-server business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here.
 */

import {
  listServers,
  getServer,
  addServer,
  removeServer,
  reconnectServer,
  disconnectServerByName,
  callTool,
} from '../lib/mcp-manager/index.js';

export function getMcpServers() {
  return { servers: listServers() };
}

export async function addMcpServer({ name, url, transport, headers, includeTools }) {
  if (!name) throw new Error('name is required');
  const server = await addServer({ name, url, transport, headers, includeTools });
  return { server };
}

export function removeMcpServer({ name }) {
  if (!name) throw new Error('name is required');
  removeServer(name);
  return { removed: name };
}

export async function reconnectMcpServer({ name }) {
  if (!name) throw new Error('name is required');
  const server = await reconnectServer(name);
  return { server };
}

export function disconnectMcpServer({ name }) {
  if (!name) throw new Error('name is required');
  disconnectServerByName(name);
  return { disconnected: name };
}

export async function executeMcpTool({ server, tool, args, sessionId }) {
  if (!server) throw new Error('server is required');
  if (!tool) throw new Error('tool is required');
  const result = await callTool(server, tool, args, sessionId);
  return { result };
}
