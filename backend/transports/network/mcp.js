/**
 * MCP routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 */

import { readBody, send } from '../../lib/http.js';
import * as mcpService from '../../services/mcp.js';

export async function handleMcpRoutes(req, res, path) {
  if (req.method === "GET" && path === "/api/mcp/servers") {
    return send(res, 200, mcpService.getMcpServers());
  }

  if (req.method === "POST" && path === "/api/mcp/servers") {
    const body = await readBody(req);
    return send(res, 201, await mcpService.addMcpServer({
      name: body.name,
      url: body.url,
      transport: body.transport,
      headers: body.headers,
      includeTools: body.includeTools,
    }));
  }

  const deleteMatch = req.method === "DELETE" && path.match(/^\/api\/mcp\/servers\/([^/]+)$/);
  if (deleteMatch) {
    const name = decodeURIComponent(deleteMatch[1]);
    return send(res, 200, mcpService.removeMcpServer({ name }));
  }

  const reconnectMatch = req.method === "POST" && path.match(/^\/api\/mcp\/servers\/([^/]+)\/reconnect$/);
  if (reconnectMatch) {
    const name = decodeURIComponent(reconnectMatch[1]);
    return send(res, 200, await mcpService.reconnectMcpServer({ name }));
  }

  const disconnectMatch = req.method === "POST" && path.match(/^\/api\/mcp\/servers\/([^/]+)\/disconnect$/);
  if (disconnectMatch) {
    const name = decodeURIComponent(disconnectMatch[1]);
    return send(res, 200, mcpService.disconnectMcpServer({ name }));
  }

  if (req.method === "POST" && path === "/api/mcp/execute") {
    const body = await readBody(req);
    return send(res, 200, await mcpService.executeMcpTool({
      server: body.server,
      tool: body.tool,
      args: body.arguments,
    }));
  }

  return false;
}
