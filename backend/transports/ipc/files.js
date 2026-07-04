/**
 * backend/transports/ipc/files.js — File-operation IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as fileService from '../../services/files.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerFileHandlers(ipcMain) {
  ipcMain.handle('files:read', async (_e, p) => fileService.readFile(p));
  ipcMain.handle('files:write', async (_e, p) => fileService.writeFile(p));
  ipcMain.handle('files:strReplace', async (_e, p) => fileService.replaceInFile(p));
  ipcMain.handle('files:replaceAll', async (_e, p) => fileService.replaceAllInFile(p));
  ipcMain.handle('files:delete', async (_e, p) => fileService.deleteFile(p));
  ipcMain.handle('files:move', async (_e, p) => fileService.moveFile(p));
  ipcMain.handle('files:listDir', async (_e, p) => fileService.listDirectory(p));
  ipcMain.handle('files:search', async (_e, p) => fileService.searchFiles(p));
  ipcMain.handle('files:workspaceGet', async () => fileService.getWorkspaceRootPath());
  ipcMain.handle('files:workspaceSet', async (_e, p) => fileService.setWorkspaceRootPath(p));

  // ── Filesystem browser ───────────────────────────────────────────────────
  ipcMain.handle('files:browseDir', async (_e, { path: browsePath = '' }) => {
    return fileService.browseDirectory(browsePath);
  });
}
