/**
 * Upgrade routes — PURE PROTOCOL LAYER.
 *
 * Only: parse HTTP request → call service → send HTTP response.
 * ZERO business logic.
 */

import { send, readBody } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import * as upgradeService from '../../services/upgrade.js';

const log = createLogger('upgrade');

export async function handleUpgradeRoutes(req, res, path) {
  if (!path.startsWith('/api/upgrade/')) return false;

  // ── GET /api/upgrade/version ───────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/upgrade/version') {
    return send(res, 200, { version: upgradeService.getVersion() });
  }

  // ── POST /api/upgrade/build ────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/upgrade/build') {
    if (!upgradeService.acquireBuildLock()) {
      return send(res, 409, { error: 'A build is already in progress.' });
    }

    const body = await readBody(req);
    const inputTerminalId = typeof body?.terminalId === 'string' ? body.terminalId : undefined;

    try {
      const result = upgradeService.startBuild({ terminalId: inputTerminalId });
      log.info(`build started — terminalId=${result.terminalId}`);
      return send(res, 200, result);
    } catch (err) {
      upgradeService.releaseBuildLock();
      return send(res, 500, { error: err.message });
    }
  }

  // ── POST /api/upgrade/restart ──────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/upgrade/restart') {
    if (!upgradeService.IS_PKG) {
      return send(res, 409, {
        error: 'Restart is only available when running as a packaged executable.',
      });
    }
    send(res, 200, { status: 'restarting' });
    upgradeService.restartProcess();
    return;
  }

  // ── POST /api/upgrade/dev/start ────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/upgrade/dev/start') {
    try {
      const result = await upgradeService.startDevServer();
      return send(res, 200, result);
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // ── POST /api/upgrade/dev/stop ─────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/upgrade/dev/stop') {
    return send(res, 200, upgradeService.stopDevServer());
  }

  // ── GET /api/upgrade/dev/status ────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/upgrade/dev/status') {
    return send(res, 200, upgradeService.getDevServerStatus());
  }

  // ── POST /api/upgrade/test ─────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/upgrade/test') {
    if (!upgradeService.acquireTestLock()) {
      return send(res, 409, { error: 'A test run is already in progress.' });
    }

    const body = await readBody(req);

    // Validate params via service — keeps pure protocol layer clean.
    let valid;
    try {
      valid = upgradeService.validateTestParams(body);
    } catch (err) {
      upgradeService.releaseTestLock();
      return send(res, 400, { error: err.message });
    }

    try {
      const result = upgradeService.startTest({
        target: valid.target,
        args: valid.argsStr,
        terminalId: body?.terminalId,
      });

      log.info(`test started — target=${valid.target} terminalId=${result.terminalId}`);
      return send(res, 200, { started: true, terminalId: result.terminalId });
    } catch (err) {
      upgradeService.releaseTestLock();
      return send(res, 500, { error: err.message });
    }
  }

  return false;
}
