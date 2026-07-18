/**
 * backend/transports/ipc/index.js — Electron IPC transport entry point
 *
 * Aggregates all domain-specific IPC handler registrations into a single
 * `registerIpcHandlers()` call.  Each domain module is a pure protocol
 * layer — it maps IPC channel names → business-logic function calls with
 * zero inline business logic.
 *
 * Exported surface:
 *   registerIpcHandlers() — registers all ipcMain.handle() channels
 */

import { ipcMain } from 'electron';
import { createLogger } from '../../lib/logger.js';
import { registerSessionHandlers } from './sessions.js';
import { registerSystemHandlers } from './system.js';
import { registerChatHandlers } from './chat.js';
import { registerApiHandlers } from './api.js';
import { registerPluginIpcHandlers } from './plugin.js';

const log = createLogger('ipc');

export function registerIpcHandlers(pluginRouter) {
  log.info('Registering IPC handlers…');

  registerSessionHandlers(ipcMain);
  registerSystemHandlers(ipcMain);
  registerChatHandlers(ipcMain);
  registerApiHandlers(ipcMain);

  // Plugin IPC handlers — registered after all built-in handlers.
  // This registers handlers for all currently active plugin API methods.
  // Git, File, and Dynamic-Tool IPC handlers are now registered via
  // their respective plugin backend activate() functions through the
  // pluginRouter.
  registerPluginIpcHandlers(ipcMain, pluginRouter);

  log.info('IPC handlers registered');
}
