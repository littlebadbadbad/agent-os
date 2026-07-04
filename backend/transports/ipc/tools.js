/**
 * backend/transports/ipc/tools.js — Dynamic-tool IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as toolService from '../../services/tools.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerToolHandlers(ipcMain) {
  ipcMain.handle('tools:list', async () => toolService.getToolsList());
  ipcMain.handle('tools:create', async (_e, p) => toolService.createTool(p));
  ipcMain.handle('tools:update', async (_e, p) => toolService.updateTool(p));
  ipcMain.handle('tools:delete', async (_e, p) => toolService.deleteTool(p));
  ipcMain.handle('tools:execute', async (_e, p) => toolService.runTool(p));
  ipcMain.handle('toolModules:list', async () => toolService.getModulesList());
  ipcMain.handle('toolModules:get', async (_e, p) => toolService.getToolModule(p));
  ipcMain.handle('toolModules:create', async (_e, p) => toolService.createToolModule(p));
  ipcMain.handle('toolModules:update', async (_e, p) => toolService.updateToolModule(p));
  ipcMain.handle('toolModules:delete', async (_e, p) => toolService.deleteToolModule(p));
  ipcMain.handle('toolDeps:list', async () => toolService.getDepsList());
  ipcMain.handle('toolDeps:install', async (_e, p) => toolService.installToolDeps(p));
  ipcMain.handle('toolDeps:remove', async (_e, p) => toolService.removeToolDep(p));
}
