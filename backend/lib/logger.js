/**
 * Lightweight structured logger with colour-coded output.
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const log = createLogger('chat');
 *   log.info('→ POST /api/chat', { provider: 'doubao', messages: 3 });
 *   log.ok('← 200', { tokens: 142 });
 *   log.warn('retrying…');
 *   log.error('upstream failed', err.message);
 */

import chalk from 'chalk';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "HH:MM:SS" from the current local time. */
const timestamp = () => new Date().toTimeString().slice(0, 8);

/**
 * Format an optional extras payload inline.
 * Scalars are printed as-is; objects/arrays are JSON-stringified (single line).
 */
function fmt(extras) {
  if (extras === undefined) return '';
  if (extras !== null && typeof extras === 'object') {
    return '  ' + chalk.dim(JSON.stringify(extras));
  }
  return '  ' + chalk.dim(String(extras));
}

// ── Level definitions ─────────────────────────────────────────────────────────

const LEVELS = {
  /** Routine informational messages — incoming requests, etc. */
  info:  { badge: chalk.bgCyan.black(' INFO  '),  out: console.log  },
  /** Successful completion of an operation. */
  ok:    { badge: chalk.bgGreen.black('  OK   '),  out: console.log  },
  /** Non-fatal anomalies — degraded behaviour, fallbacks, etc. */
  warn:  { badge: chalk.bgYellow.black(' WARN  '),  out: console.warn },
  /** Errors that affect a single request or operation. */
  error: { badge: chalk.bgRed.white(  ' ERROR '),  out: console.error },
  /** Verbose internals, disabled in PROD (set LOG_LEVEL=silent to suppress). */
  debug: { badge: chalk.bgGray.white( ' DEBUG '),  out: console.log  },
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a logger bound to a specific subsystem namespace.
 *
 * @param {string} ns  Short label displayed in every log line, e.g. "chat", "tools".
 * @returns {{ info, ok, warn, error, debug }}
 */
export function createLogger(ns) {
  const tag = chalk.bold(`[${ns}]`);
  const silent = process.env.LOG_LEVEL === 'silent';

  return Object.fromEntries(
    Object.entries(LEVELS).map(([name, { badge, out }]) => [
      name,
      (msg, extras) => {
        if (silent) return;
        out(`${chalk.dim(timestamp())} ${badge} ${tag} ${msg}${fmt(extras)}`);
      },
    ]),
  );
}
