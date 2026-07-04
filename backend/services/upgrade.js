/**
 * backend/lib/services/upgrade.js — Upgrade lifecycle business logic
 *
 * Centralises version derivation, terminal command execution, dev-server
 * lifecycle, and build/test concurrency management so that HTTP routes
 * (and future IPC handlers) are pure protocol passthroughs.
 */

import { randomBytes } from 'crypto';
import { basename, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { EXE_DIR, PROJECT_ROOT, IS_PKG } from '../lib/paths.js';

// ── Is packaged mode ─────────────────────────────────────────────────────────

export { IS_PKG };
import {
  createTerminal,
  getTerminal,
  removeTerminal,
  streamTerminalOutput,
  writeToTerminal,
} from '../lib/shell-manager/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('upgrade-service');

// ── Exit code for restart ────────────────────────────────────────────────────

export const RESTART_CODE = 75;

// ── Source root resolution ────────────────────────────────────────────────────

export const SOURCE_ROOT = IS_PKG ? join(PROJECT_ROOT, '..') : PROJECT_ROOT;

// ── Version ───────────────────────────────────────────────────────────────────

/**
 * Derive the current running version string.
 *
 * @returns {string}
 */
export function getVersion() {
  if (IS_PKG) {
    return basename(EXE_DIR);
  }
  try {
    const pkgPath = join(SOURCE_ROOT, 'package.json');
    if (existsSync(pkgPath)) {
      const ver = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
      if (ver) return String(ver);
    }
  } catch { /* ignore */ }
  return 'unknown';
}

// ── Shell helpers ─────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';
const EXIT_CODE_VAR = IS_WIN ? '%ERRORLEVEL%' : '$?';

function oneShot(command) {
  return IS_WIN ? `cmd.exe /c ${command}` : command;
}

// ── Terminal command execution ────────────────────────────────────────────────

/**
 * Run a shell command and resolve when done.
 *
 * @param {object}  opts
 * @param {string}  opts.command
 * @param {string}  opts.cwd
 * @param {string}  opts.label
 * @param {string} [opts.terminalId] - reuse an existing terminal
 * @returns {Promise<{ terminalId: string; exitCode: number; output: string; success: boolean }>}
 */
export function runUpgradeCommand({ command, cwd, label, terminalId }) {
  return terminalId
    ? _runInExisting(terminalId, command)
    : _runOneShot(command, cwd, label);
}

function _runOneShot(command, cwd, label) {
  return new Promise((resolve) => {
    const term = createTerminal({ label, cwd });
    const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
    const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

    let output = '';
    let settled = false;
    streamTerminalOutput(term.id, ({ text, done, exitCode: ec }) => {
      if (done && !settled) {
        settled = true;
        resolve({ terminalId: term.id, exitCode: ec ?? -1, output, success: ec === 0 });
        return;
      }
      output += text;
      const m = output.match(sentinelRe);
      if (m && !settled) {
        settled = true;
        resolve({ terminalId: term.id, exitCode: parseInt(m[1], 10), output, success: m[1] === '0' });
      }
    });

    try {
      term.write(`${command}\n`);
      term.write(`echo ${sentinel}:${EXIT_CODE_VAR}\n`);
    } catch (err) {
      if (!settled) {
        settled = true;
        resolve({ terminalId: term.id, exitCode: -1, output: `Failed to write command: ${err.message}`, success: false });
      }
    }
  });
}

function _runInExisting(terminalId, command) {
  const term = getTerminal(terminalId);
  if (!term || !term.running) {
    return Promise.reject(new Error(`Terminal "${terminalId}" is not available`));
  }

  const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
  const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

  return new Promise((resolve, reject) => {
    let captured = '';
    let settled = false;

    const unsub = streamTerminalOutput(terminalId, ({ text, done, exitCode: ec }) => {
      if (done) {
        if (!settled) {
          settled = true;
          reject(new Error('Terminal exited while waiting for command to complete'));
        }
        return;
      }
      captured += text;
      const m = captured.match(sentinelRe);
      if (m && !settled) {
        settled = true;
        unsub();
        const code = parseInt(m[1], 10);
        resolve({ terminalId, exitCode: code, output: captured, success: code === 0 });
      }
    });

    try {
      writeToTerminal(terminalId, `${command}\n`);
      writeToTerminal(terminalId, `echo ${sentinel}:${EXIT_CODE_VAR}\n`);
    } catch (err) {
      if (!settled) {
        settled = true;
        unsub();
        reject(err);
      }
    }
  });
}

// ── Build concurrency lock ────────────────────────────────────────────────────

let _buildInFlight = false;

/**
 * Acquire the build lock.
 * @returns {boolean} true if lock acquired, false if already in flight
 */
export function acquireBuildLock() {
  if (_buildInFlight) return false;
  _buildInFlight = true;
  return true;
}

/** Release the build lock. */
export function releaseBuildLock() {
  _buildInFlight = false;
}

/**
 * Run a full build (pnpm build:exe) in a terminal with sentinel-based
 * completion detection.  Releases the build lock automatically when done.
 *
 * @param {object} opts
 * @param {string} [opts.terminalId] - reuse an existing terminal
 * @param {string} [opts.cwd]
 * @returns {{ started: true, terminalId: string }}
 */
export function startBuild({ terminalId, cwd } = {}) {
  const targetCwd = cwd ?? SOURCE_ROOT;

  if (terminalId) {
    const term = getTerminal(terminalId);
    if (!term || !term.running) {
      throw new Error(`Terminal "${terminalId}" is not available`);
    }
    const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
    const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

    writeToTerminal(terminalId, 'pnpm build:exe\n');
    writeToTerminal(terminalId, `echo ${sentinel}:${EXIT_CODE_VAR}\n`);

    let captured = '';
    let released = false;
    const unsub = streamTerminalOutput(terminalId, ({ text, done }) => {
      if (released) return;
      if (done) { released = true; _buildInFlight = false; log.info('build terminal exited'); return; }
      captured += text;
      if (sentinelRe.test(captured)) { released = true; _buildInFlight = false; log.info('build complete'); unsub(); }
    });

    return { started: true, terminalId };
  }

  const term = createTerminal({ label: 'Build', cwd: targetCwd });
  const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
  const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

  writeToTerminal(term.id, 'pnpm build:exe\n');
  writeToTerminal(term.id, `echo ${sentinel}:${EXIT_CODE_VAR}\n`);

  let captured = '';
  let released = false;
  const unsub = streamTerminalOutput(term.id, ({ text, done }) => {
    if (released) return;
    if (done) { released = true; _buildInFlight = false; log.info('build terminal exited'); return; }
    captured += text;
    if (sentinelRe.test(captured)) { released = true; _buildInFlight = false; log.info('build complete'); unsub(); }
  });

  return { started: true, terminalId: term.id };
}

// ── Test concurrency lock ─────────────────────────────────────────────────────

let _testInFlight = false;

export function acquireTestLock() {
  if (_testInFlight) return false;
  _testInFlight = true;
  return true;
}

export function releaseTestLock() {
  _testInFlight = false;
}

// ── Test / typecheck config map ───────────────────────────────────────────────

export const VITEST_CONFIGS = {
  backend: 'vitest.config.ts',
  sdk: 'vitest.sdk.config.ts',
};

export const TYPECHECK_COMMAND = 'npx tsc --noEmit';

/**
 * Run a test suite in a terminal with sentinel-based completion detection.
 * Releases the test lock automatically when done.
 *
 * @param {object} opts
 * @param {string}  opts.target - 'backend', 'sdk', or 'typecheck'
 * @param {string} [opts.terminalId] - reuse an existing terminal
 * @param {string} [opts.args] - extra CLI arguments to append
 * @returns {{ started: true, terminalId: string }}
 */
export function startTest({ target, terminalId, args } = {}) {
  const command = target === 'typecheck'
    ? TYPECHECK_COMMAND
    : `npx vitest run --config ${VITEST_CONFIGS[target]} ${args ?? ''}`;

  if (terminalId) {
    const term = getTerminal(terminalId);
    if (!term || !term.running) {
      throw new Error(`Terminal "${terminalId}" is not available`);
    }
    const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
    const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

    writeToTerminal(terminalId, `${command}\n`);
    writeToTerminal(terminalId, `echo ${sentinel}:${EXIT_CODE_VAR}\n`);

    let captured = '';
    let released = false;
    const unsub = streamTerminalOutput(terminalId, ({ text, done }) => {
      if (released) return;
      if (done) { released = true; _testInFlight = false; log.info('test terminal exited'); return; }
      captured += text;
      if (sentinelRe.test(captured)) { released = true; _testInFlight = false; log.info('test complete'); unsub(); }
    });

    return { started: true, terminalId };
  }

  const term = createTerminal({ label: `Test (${target})`, cwd: SOURCE_ROOT });
  const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
  const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

  writeToTerminal(term.id, `${command}\n`);
  writeToTerminal(term.id, `echo ${sentinel}:${EXIT_CODE_VAR}\n`);

  let captured = '';
  let released = false;
  const unsub = streamTerminalOutput(term.id, ({ text, done }) => {
    if (released) return;
    if (done) { released = true; _testInFlight = false; log.info('test terminal exited'); return; }
    captured += text;
    if (sentinelRe.test(captured)) { released = true; _testInFlight = false; log.info('test complete'); unsub(); }
  });

  return { started: true, terminalId: term.id };
}

// ── Dev server management ─────────────────────────────────────────────────────

let _devServerTerminalId = null;
let _devServerUrl = null;

function _isDevServerAlive() {
  if (!_devServerTerminalId) return false;
  const term = getTerminal(_devServerTerminalId);
  return term !== null && term.running;
}

/**
 * Start the frontend dev server (pnpm start).
 *
 * @returns {Promise<{ url: string, terminalId: string, alreadyRunning: boolean }>}
 */
export function startDevServer() {
  return new Promise((resolve, reject) => {
    if (_isDevServerAlive()) {
      resolve({ url: _devServerUrl, terminalId: _devServerTerminalId, alreadyRunning: true });
      return;
    }

    const term = createTerminal({ label: 'Vite Dev Server', cwd: SOURCE_ROOT });
    _devServerTerminalId = term.id;

    try {
      term.write('pnpm start\n');
    } catch (err) {
      removeTerminal(term.id);
      _devServerTerminalId = null;
      reject(err);
      return;
    }

    const deadline = Date.now() + 30_000;
    const POLL_MS = 250;
    const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g;
    let accumulated = '';
    let offset = 0;

    function poll() {
      const snap = term.read(offset);
      accumulated += snap.output;
      offset = snap.offset;

      const clean = accumulated.replace(ANSI_RE, '');
      const m = clean.match(/Local:\s+(https?:\/\/[^\s\r\n]+)/);
      if (m) {
        const url = m[1].replace(/\/$/, '');
        _devServerUrl = url;
        streamTerminalOutput(term.id, ({ done }) => {
          if (done && _devServerTerminalId === term.id) {
            _devServerTerminalId = null;
            _devServerUrl = null;
          }
        });
        resolve({ url, terminalId: term.id, alreadyRunning: false });
        return;
      }

      if (!snap.running) {
        if (_devServerTerminalId === term.id) _devServerTerminalId = null;
        reject(new Error(`Dev server exited before becoming ready (code=${snap.exitCode ?? 'unknown'})`));
        return;
      }

      if (Date.now() >= deadline) {
        removeTerminal(term.id);
        _devServerTerminalId = null;
        _devServerUrl = null;
        reject(new Error('Dev server did not print a URL within 30 s'));
        return;
      }

      setTimeout(poll, POLL_MS);
    }

    setTimeout(poll, 0);
  });
}

/**
 * Stop the frontend dev server.
 *
 * @returns {{ stopped: boolean, reason?: string }}
 */
export function stopDevServer() {
  if (!_isDevServerAlive()) {
    return { stopped: false, reason: 'not running' };
  }
  const termId = _devServerTerminalId;
  _devServerTerminalId = null;
  _devServerUrl = null;
  removeTerminal(termId);
  log.info('dev server stopped');
  return { stopped: true };
}

/**
 * Check if the dev server is alive.
 *
 * @returns {{ running: boolean, url?: string, terminalId?: string }}
 */
export function getDevServerStatus() {
  const alive = _isDevServerAlive();
  return {
    running: alive,
    url: alive ? _devServerUrl : undefined,
    terminalId: alive ? _devServerTerminalId : undefined,
  };
}

// ── Restart ───────────────────────────────────────────────────────────────────

/**
 * Restart the process with the configured restart code.
 * Only effective in packaged mode — caller must check IS_PKG first.
 */
export function restartProcess() {
  log.info('restart requested — will exit with RESTART_CODE in 1 s');
  setTimeout(() => {
    log.info(`exiting with code ${RESTART_CODE}`);
    process.exit(RESTART_CODE);
  }, 1_000);
}

// ── Test parameter validation ─────────────────────────────────────────────────

/**
 * Validate test-run parameters.
 * Returns validated target + args; throws with human-readable message on failure.
 *
 * @param {{ target?: string, args?: string[] }} opts
 * @returns {{ target: string, argsStr: string }}
 */
export function validateTestParams({ target, args = [] } = {}) {
  if (target !== 'backend' && target !== 'sdk' && target !== 'typecheck') {
    throw new Error('target must be "backend", "sdk", or "typecheck"');
  }
  if (!Array.isArray(args)) {
    throw new Error('args must be an array of strings');
  }
  if (args.some((a) => typeof a !== 'string')) {
    throw new Error('args must be an array of strings');
  }
  return { target, argsStr: args.join(' ') };
}
