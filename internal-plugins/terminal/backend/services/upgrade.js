/**
 * internal-plugins/terminal/backend/services/upgrade.js — Upgrade lifecycle business logic
 *
 * Centralises version derivation, terminal command execution, dev-server
 * lifecycle, and build/test concurrency management.
 *
 * Terminal operations use co-located terminal services (same plugin).
 */

import { randomBytes } from 'crypto';
import { basename, join } from 'path';
import { readFileSync, existsSync } from 'fs';

// ── Terminal services (co-located in the same plugin) ──────────────────────
import {
  createTerminalSession,
  getTerminalSession,
  removeTerminalSession,
  sendTerminalInput,
  readTerminalOutput,
  subscribeTerminalOutput,
} from './terminals.js';

/** @import { Logger, BackendPluginHost } from '../../../../agent-type/plugin.ts' */

/** @type {Logger} */
let log = { info() {}, ok() {}, warn() {}, error() {}, debug() {} };

/**
 * Initialise the upgrade module with a logger from the host.
 * Called once during plugin activation — replaces the noop starter.
 *
 * @param {BackendPluginHost} host
 */
export function init(host) {
  log = host.logger;
}

// ── Runtime mode ───────────────────────────────────────────────────────────

export const IS_PKG = process.env.UAP_IS_PACKAGED === '1';
const PROJECT_ROOT = process.cwd();
const EXE_DIR = IS_PKG ? join(PROJECT_ROOT, 'release') : PROJECT_ROOT;

// ── Exit code for restart ──────────────────────────────────────────────────

export const RESTART_CODE = 75;

// ── Source root ────────────────────────────────────────────────────────────

export const SOURCE_ROOT = IS_PKG ? join(PROJECT_ROOT, '..') : PROJECT_ROOT;

// ── Version ────────────────────────────────────────────────────────────────

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

// ── Shell helpers ──────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';
const EXIT_CODE_VAR = IS_WIN ? '%ERRORLEVEL%' : '$?';

// ── Sentinel-based command execution ───────────────────────────────────────

/**
 * Send a command to an interactive terminal and watch for a sentinel
 * indicating completion.
 *
 * The sentinel pattern works by:
 *   1. Sending the command to the terminal
 *   2. Sending `echo {sentinel}:{EXIT_CODE_VAR}` immediately after
 *   3. Watching output for the sentinel regex
 *   4. When matched, extracting the exit code
 *
 * @param {object} opts
 * @param {string} opts.terminalId - Terminal session to send to
 * @param {string} opts.command - Shell command to execute
 * @param {(result: { exitCode: number, output: string, success: boolean }) => void} opts.onComplete
 *        Called when the sentinel is matched (command finished).
 * @param {(info: { exitCode: number, output: string }) => void} [opts.onExit]
 *        Called when the terminal exits before the sentinel is matched.
 * @returns {() => void} Unsubscribe function (aborts the subscription).
 */
function _runWithSentinel({ terminalId, command, onComplete, onExit }) {
  const sentinel = `__UPGRD_${randomBytes(4).toString('hex')}__`;
  const sentinelRe = new RegExp(`${sentinel}:(\\d+)`);

  let captured = '';
  let settled = false;
  const ctrl = new AbortController();

  subscribeTerminalOutput({
    id: terminalId,
    signal: ctrl.signal,
    onOutput: (text) => {
      if (settled) return;
      captured += text;
      const m = captured.match(sentinelRe);
      if (m) {
        settled = true;
        ctrl.abort();
        const exitCode = parseInt(m[1], 10);
        onComplete({ exitCode, output: captured, success: exitCode === 0 });
      }
    },
    onDone: (ec) => {
      if (!settled) {
        settled = true;
        ctrl.abort();
        onExit?.({ exitCode: ec ?? -1, output: captured });
      }
    },
  });

  try {
    sendTerminalInput({ id: terminalId, text: `${command}\n` });
    sendTerminalInput({ id: terminalId, text: `echo ${sentinel}:${EXIT_CODE_VAR}\n` });
  } catch (err) {
    if (!settled) {
      settled = true;
      ctrl.abort();
      onExit?.({ exitCode: -1, output: `Failed to write command: ${err.message}` });
    }
  }

  return () => ctrl.abort();
}

// ── Terminal command execution ─────────────────────────────────────────────

/**
 * Run a shell command and resolve when done.
 */
export function runUpgradeCommand({ command, cwd, label, terminalId }) {
  return terminalId
    ? _runInExisting(terminalId, command)
    : _runOneShot(command, cwd, label);
}

function _runOneShot(command, cwd, label) {
  return new Promise((resolve) => {
    const info = createTerminalSession({ label, cwd });
    _runWithSentinel({
      terminalId: info.id,
      command,
      onComplete: (result) => resolve({ terminalId: info.id, ...result }),
      onExit: (info2) => resolve({
        terminalId: info.id,
        exitCode: info2.exitCode,
        output: info2.output,
        success: false,
      }),
    });
  });
}

function _runInExisting(terminalId, command) {
  const term = getTerminalSession({ id: terminalId });
  if (!term || !term.running) {
    return Promise.reject(
      new Error(`Terminal "${terminalId}" is not available`),
    );
  }

  return new Promise((resolve, reject) => {
    _runWithSentinel({
      terminalId,
      command,
      onComplete: (result) => resolve({ terminalId, ...result }),
      onExit: () => reject(
        new Error('Terminal exited while waiting for command to complete'),
      ),
    });
  });
}

// ── Background command (fire-and-forget with lock release) ─────────────────

/**
 * Start a background command in a terminal (new or existing) and release
 * a concurrency lock when it completes.
 *
 * @param {object} opts
 * @param {string} opts.command - Shell command to execute
 * @param {string} opts.label - Terminal label (for new sessions)
 * @param {string} [opts.terminalId] - Existing terminal to reuse
 * @param {string} [opts.cwd] - Working directory (for new sessions)
 * @param {() => void} opts.releaseLock - Called when command finishes or terminal exits
 * @param {string} opts.logTag - Tag for log messages (e.g. 'build', 'test')
 * @returns {{ started: boolean, terminalId: string }}
 */
function _startBackgroundCommand({ command, label, terminalId, cwd, releaseLock, logTag }) {
  let id = terminalId;

  if (terminalId) {
    let term;
    try {
      term = getTerminalSession({ id: terminalId });
    } catch {
      throw new Error(`Terminal "${terminalId}" is not available`);
    }
    if (!term.running)
      throw new Error(`Terminal "${terminalId}" is not available`);
  } else {
    const info = createTerminalSession({ label, cwd });
    id = info.id;
  }

  _runWithSentinel({
    terminalId: id,
    command,
    onComplete: () => {
      releaseLock();
      log.info(`${logTag} complete`);
    },
    onExit: () => {
      releaseLock();
      log.info(`${logTag} terminal exited`);
    },
  });

  return { started: true, terminalId: id };
}

// ── Build concurrency lock ─────────────────────────────────────────────────

let _buildInFlight = false;

export function acquireBuildLock() {
  if (_buildInFlight) return false;
  _buildInFlight = true;
  return true;
}

export function releaseBuildLock() {
  _buildInFlight = false;
}

export function startBuild({ terminalId, cwd } = {}) {
  return _startBackgroundCommand({
    command: 'pnpm build:exe',
    label: 'Build',
    terminalId,
    cwd: cwd ?? SOURCE_ROOT,
    releaseLock: () => { _buildInFlight = false; },
    logTag: 'build',
  });
}

// ── Test concurrency lock ──────────────────────────────────────────────────

let _testInFlight = false;

export function acquireTestLock() {
  if (_testInFlight) return false;
  _testInFlight = true;
  return true;
}

export function releaseTestLock() {
  _testInFlight = false;
}

export const VITEST_CONFIGS = {
  backend: 'vitest.config.ts',
  sdk: 'vitest.sdk.config.ts',
};

export const TYPECHECK_COMMAND = 'npx tsc --noEmit';

export function startTest({ target, terminalId, args } = {}) {
  const command =
    target === 'typecheck'
      ? TYPECHECK_COMMAND
      : `npx vitest run --config ${VITEST_CONFIGS[target]} ${args ?? ''}`;

  return _startBackgroundCommand({
    command,
    label: `Test (${target})`,
    terminalId,
    cwd: SOURCE_ROOT,
    releaseLock: () => { _testInFlight = false; },
    logTag: 'test',
  });
}

// ── Dev server management ──────────────────────────────────────────────────

let _devServerTerminalId = null;
let _devServerUrl = null;

function _isDevServerAlive() {
  if (!_devServerTerminalId) return false;
  try {
    const term = getTerminalSession({ id: _devServerTerminalId });
    return term.running;
  } catch {
    return false;
  }
}

export function startDevServer() {
  return new Promise((resolve, reject) => {
    if (_isDevServerAlive()) {
      resolve({
        url: _devServerUrl,
        terminalId: _devServerTerminalId,
        alreadyRunning: true,
      });
      return;
    }

    const info = createTerminalSession({
      label: 'Vite Dev Server',
      cwd: SOURCE_ROOT,
    });
    _devServerTerminalId = info.id;

    try {
      sendTerminalInput({ id: info.id, text: 'pnpm start\n' });
    } catch (err) {
      removeTerminalSession({ id: info.id });
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
      const snap = readTerminalOutput({ id: info.id, fromOffset: offset });
      accumulated += snap.output;
      offset = snap.offset;

      const clean = accumulated.replace(ANSI_RE, '');
      const m = clean.match(/Local:\s+(https?:\/\/[^\s\r\n]+)/);
      if (m) {
        const url = m[1].replace(/\/$/, '');
        _devServerUrl = url;
        subscribeTerminalOutput({
          id: info.id,
          signal: new AbortController().signal,
          onOutput: () => {},
          onDone: () => {
            if (_devServerTerminalId === info.id) {
              _devServerTerminalId = null;
              _devServerUrl = null;
            }
          },
        });
        resolve({ url, terminalId: info.id, alreadyRunning: false });
        return;
      }

      if (!snap.running) {
        if (_devServerTerminalId === info.id) _devServerTerminalId = null;
        reject(
          new Error(
            `Dev server exited before becoming ready (code=${snap.exitCode ?? 'unknown'})`,
          ),
        );
        return;
      }

      if (Date.now() >= deadline) {
        removeTerminalSession({ id: info.id });
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

export function stopDevServer() {
  if (!_isDevServerAlive()) {
    return { stopped: false, reason: 'not running' };
  }
  const termId = _devServerTerminalId;
  _devServerTerminalId = null;
  _devServerUrl = null;
  removeTerminalSession({ id: termId });
  log.info('dev server stopped');
  return { stopped: true };
}

export function getDevServerStatus() {
  const alive = _isDevServerAlive();
  return {
    running: alive,
    url: alive ? _devServerUrl : undefined,
    terminalId: alive ? _devServerTerminalId : undefined,
  };
}

// ── Restart ────────────────────────────────────────────────────────────────

export function restartProcess() {
  log.info('restart requested — will exit with RESTART_CODE in 1 s');
  setTimeout(() => {
    log.info(`exiting with code ${RESTART_CODE}`);
    process.exit(RESTART_CODE);
  }, 1_000);
}

// ── Test parameter validation ──────────────────────────────────────────────

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
