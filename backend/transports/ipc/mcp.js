/**
 * backend/transports/ipc/mcp.js — MCP server IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as mcpService from '../../services/mcp.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerMcpHandlers(ipcMain) {
  ipcMain.handle('mcp:list', async () => mcpService.getMcpServers());
  ipcMain.handle('mcp:add', async (_e, p) => mcpService.addMcpServer(p));
  ipcMain.handle('mcp:remove', async (_e, p) => mcpService.removeMcpServer(p));
  ipcMain.handle('mcp:reconnect', async (_e, p) => mcpService.reconnectMcpServer(p));
  ipcMain.handle('mcp:disconnect', async (_e, p) => mcpService.disconnectMcpServer(p));
  ipcMain.handle('mcp:execute', async (_e, p) => mcpService.executeMcpTool(p));
}
