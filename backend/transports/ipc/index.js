/**
 * backend/transports/ipc/index.js — Electron IPC transport entry point
 *
 * Core APIs (system, proxy, models, sessions, chat, etc.) are now registered
 * as super built-in plugins via `backend/core/` — they go through the shared
 * pluginRouter instead of ipcMain.handle().
 *
 * Even chat streaming now uses the pluginRouter's defineStream pattern,
 * which the IPC plugin handler (`plugin.js`) transparently bridges via
 * event.sender.send() — no separate chat IPC handler needed.
 *
 * Exported surface:
 *   registerIpcHandlers() — registers all ipcMain.handle() channels
 */

import { ipcMain } from 'electron';
import { createLogger } from '../../lib/logger.js';
import { registerPluginIpcHandlers } from './plugin.js';

const log = createLogger('ipc');

export function registerIpcHandlers(pluginRouter) {
  log.info('Registering IPC handlers…');

  // Plugin IPC handlers — registers handlers for ALL active plugins
  // (both core and external) through the shared pluginRouter.
  // This includes the "chat" plugin's chatStream stream and all
  // core API methods (async, streamStop, etc.).
  // Core plugins are registered before this call in startServer().
  registerPluginIpcHandlers(ipcMain, pluginRouter);

  log.info('IPC handlers registered');
}
