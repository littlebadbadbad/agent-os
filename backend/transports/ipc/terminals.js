/**
 * backend/transports/ipc/terminals.js — Terminal IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 *
 * Streaming channels (streamStart, streamStop) are inherently Electron-specific
 * as they use BrowserWindow.fromWebContents() to route output to the correct
 * renderer.  All other channels are simple pass-through to the service layer.
 *
 * Stream-state registry shared via streamRegistry from lib/.
 */

import { BrowserWindow } from 'electron';
import * as terminalService from '../../services/terminals.js';
import { streamRegistry } from '../../lib/stream-registry.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerTerminalHandlers(ipcMain) {
  ipcMain.handle('terminals:list', async () => terminalService.listTerminals());
  ipcMain.handle('terminals:shells', async () => terminalService.availableShells());
  ipcMain.handle('terminals:create', async (_e, p) => terminalService.createTerminalSession(p));
  ipcMain.handle('terminals:remove', async (_e, p) => terminalService.removeTerminalSession(p));
  ipcMain.handle('terminals:sendInput', async (_e, p) => terminalService.sendTerminalInput(p));
  ipcMain.handle('terminals:readOutput', async (_e, p) => terminalService.readTerminalOutput(p));
  ipcMain.handle('terminals:resize', async (_e, p) => terminalService.resizeTerminalSession(p));

  ipcMain.handle('terminals:streamStart', (event, params) => {
    const { id } = params ?? {};
    if (!id) throw new Error('terminals:streamStart — id is required');

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window for terminal stream');

    const ctrl = new AbortController();
    streamRegistry.set(id, { tag: 'terminal', ctrl, aborted: false });

    terminalService.subscribeTerminalOutput({
      id,
      signal: ctrl.signal,
      onOutput: (text) => { if (!win.isDestroyed()) win.webContents.send(`terminal:output:${id}`, text); },
      onDone: (exitCode) => {
        if (!win.isDestroyed()) win.webContents.send(`terminal:done:${id}`, exitCode);
        streamRegistry.delete(id);
      },
    });

    win.on('closed', () => { streamRegistry.abort(id); });
    return { ok: true };
  });

  ipcMain.handle('terminals:streamStop', async (_e, p) => {
    const { id } = p ?? {};
    if (id) streamRegistry.abort(id);
    return { ok: true };
  });
}
