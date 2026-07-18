/**
 * backend/transports/ipc/sessions.js — Session-persistence IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as sessionService from '../../services/sessions.js';

/** @import { IpcMain } from 'electron' */

/** @param {IpcMain} ipcMain */
export function registerSessionHandlers(ipcMain) {
  ipcMain.handle('sessions:load', async (_e, p) => sessionService.loadAgentSessions(p));
  ipcMain.handle('sessions:save', async (_e, p) => sessionService.saveAgentSessions(p));
}
