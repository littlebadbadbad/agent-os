/**
 * backend/transports/ipc/cron.js — Cron-job IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 *
 * The listening channels are Electron-specific (BrowserWindow, webContents.send)
 * and remain here as pure transport wiring.
 */

import { BrowserWindow } from 'electron';
import * as cronService from '../../services/cron.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerCronHandlers(ipcMain) {
  ipcMain.handle('cron:list', async (_e, p) => cronService.listCronJobs(p));
  ipcMain.handle('cron:create', async (_e, p) => cronService.createCronJob(p));
  ipcMain.handle('cron:pause', async (_e, p) => cronService.pauseCronJob(p));
  ipcMain.handle('cron:resume', async (_e, p) => cronService.resumeCronJob(p));
  ipcMain.handle('cron:delete', async (_e, p) => cronService.deleteCronJob(p));

  ipcMain.handle('cron:startListening', (event, params) => {
    const { sessionId } = params;
    if (!sessionId) throw new Error('cron:startListening — sessionId is required');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window for cron events');
    cronService.subscribeCronEvents({
      sessionId,
      onFired: (jobId, prompt) => {
        if (!win.isDestroyed()) {
          win.webContents.send('cron:fired', { jobId, prompt, sessionId });
        }
      },
    });
    return { ok: true };
  });

  ipcMain.handle('cron:stopListening', async () => ({ ok: true }));
}
