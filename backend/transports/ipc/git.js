/**
 * backend/transports/ipc/git.js — Git-operation IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as gitService from '../../services/git.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerGitHandlers(ipcMain) {
  ipcMain.handle('git:status', async () => gitService.getGitStatus());
  ipcMain.handle('git:diff', async (_e, p) => gitService.getGitDiff(p));
  ipcMain.handle('git:log', async (_e, p) => gitService.getGitLog(p));
  ipcMain.handle('git:stage', async (_e, p) => gitService.stageGit(p));
  ipcMain.handle('git:unstage', async (_e, p) => gitService.unstageGit(p));
  ipcMain.handle('git:commit', async (_e, p) => gitService.commitGit(p));
  ipcMain.handle('git:discard', async (_e, p) => gitService.discardGit(p));
}
