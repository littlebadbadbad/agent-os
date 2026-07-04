/**
 * backend/transports/ipc/upgrade.js — Upgrade lifecycle IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 *
 * Bridges the SDK's UpgradeAdapter IPC channels to the upgrade service.
 * Terminal read/write operations are delegated to the terminal IPC handlers.
 */

import * as upgradeService from '../../services/upgrade.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ipc-upgrade');

/** @param {import('electron').IpcMain} ipcMain */
export function registerUpgradeHandlers(ipcMain) {
  // ── Version ───────────────────────────────────────────────────────────────
  ipcMain.handle('upgrade:version', async () => ({ version: upgradeService.getVersion() }));

  // ── Build ─────────────────────────────────────────────────────────────────
  ipcMain.handle('upgrade:build', async (_event, opts) => {
    if (!upgradeService.acquireBuildLock()) {
      throw new Error('A build is already in progress.');
    }
    try {
      return upgradeService.startBuild({ terminalId: opts?.terminalId });
    } catch (err) {
      upgradeService.releaseBuildLock();
      throw err;
    }
  });

  // ── Restart (packaged only) ───────────────────────────────────────────────
  ipcMain.handle('upgrade:restart', async () => {
    if (!upgradeService.IS_PKG) {
      throw new Error('Restart is only available when running as a packaged executable.');
    }
    upgradeService.restartProcess();
  });

  // ── Dev server ────────────────────────────────────────────────────────────
  ipcMain.handle('upgrade:devStart', async () => upgradeService.startDevServer());
  ipcMain.handle('upgrade:devStop', async () => upgradeService.stopDevServer());
  ipcMain.handle('upgrade:devStatus', async () => upgradeService.getDevServerStatus());

  // ── Run tests ─────────────────────────────────────────────────────────────
  ipcMain.handle('upgrade:runTests', async (_event, opts) => {
    // Validate params via service — keeps pure protocol layer clean.
    const { target, argsStr } = upgradeService.validateTestParams(opts);

    if (!upgradeService.acquireTestLock()) {
      throw new Error('A test run is already in progress.');
    }
    try {
      return upgradeService.startTest({ target, args: argsStr, terminalId: opts?.terminalId });
    } catch (err) {
      upgradeService.releaseTestLock();
      throw err;
    }
  });
}
