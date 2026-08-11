/**
 * backend/transports/ipc/index.js — Electron IPC transport entry point
 *
 * Core APIs (system, proxy, models, sessions, chat, etc.) are now registered
 * as super built-in apps via `backend/core/` — they go through the shared
 * appRouter instead of ipcMain.handle().
 *
 * Even chat streaming now uses the appRouter's defineStream pattern,
 * which the IPC app handler (`app.js`) transparently bridges via
 * event.sender.send() — no separate chat IPC handler needed.
 *
 * Exported surface:
 *   registerIpcHandlers() — registers all ipcMain.handle() channels
 */

import { ipcMain } from 'electron';
import { createLogger } from '../../lib/logger.js';
import { registerAppIpcHandlers } from './app.js';

const log = createLogger('ipc');

export function registerIpcHandlers(appRouter) {
  log.info('Registering IPC handlers…');

  // App IPC handlers — registers handlers for ALL active apps
  // (both core and external) through the shared appRouter.
  // This includes the "chat" app's chatStream stream and all
  // core API methods (async, streamStop, etc.).
  // Core apps are registered before this call in startServer().
  registerAppIpcHandlers(ipcMain, appRouter);

  log.info('IPC handlers registered');
}
