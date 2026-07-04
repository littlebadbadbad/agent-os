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
import { registerFileHandlers } from './files.js';
import { registerTerminalHandlers } from './terminals.js';
import { registerCronHandlers } from './cron.js';
import { registerToolHandlers } from './tools.js';
import { registerSkillHandlers } from './skills.js';
import { registerMcpHandlers } from './mcp.js';
import { registerGitHandlers } from './git.js';
import { registerSessionHandlers } from './sessions.js';
import { registerSystemHandlers } from './system.js';
import { registerUpgradeHandlers } from './upgrade.js';
import { registerChatHandlers } from './chat.js';
import { registerApiHandlers } from './api.js';
import { registerPluginIpcHandlers } from './plugin.js';

const log = createLogger('ipc');

export function registerIpcHandlers(pluginRouter) {
  log.info('Registering IPC handlers…');

  registerFileHandlers(ipcMain);
  registerTerminalHandlers(ipcMain);
  registerCronHandlers(ipcMain);
  registerToolHandlers(ipcMain);
  registerSkillHandlers(ipcMain);
  registerMcpHandlers(ipcMain);
  registerGitHandlers(ipcMain);
  registerSessionHandlers(ipcMain);
  registerSystemHandlers(ipcMain);
  registerUpgradeHandlers(ipcMain);
  registerChatHandlers(ipcMain);
  registerApiHandlers(ipcMain);

  // Plugin IPC handlers — registered after all built-in handlers.
  // This registers handlers for all currently active plugin API methods.
  registerPluginIpcHandlers(ipcMain, pluginRouter);

  log.info('IPC handlers registered');
}
