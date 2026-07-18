/**
 * backend/transports/ipc/system.js — System-info IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as systemService from '../../services/system.js';

/** @import { IpcMain } from 'electron' */

/** @param {IpcMain} ipcMain */
export function registerSystemHandlers(ipcMain) {
  ipcMain.handle('health:check', async () => systemService.checkHealth());
  ipcMain.handle('publicKey:get', async () => systemService.getPublicKeyInfo());
}
