/**
 * shell-manager — public API for interactive terminal management.
 *
 * Thin coordination layer on top of the two sub-modules:
 *   shell-discovery    — host shell enumeration
 *   terminal-instance  — PTY-backed TerminalInstance class
 *
 * Exported surface (consumed by routes/terminals.js and tests):
 *   listAvailableShells()
 *   createTerminal(opts?)          → TerminalInstance
 *   getTerminal(id)                → TerminalInstance | null
 *   listTerminalEntries()          → info[] (all live terminals)
 *   removeTerminal(id)             → boolean
 *   writeToTerminal(id, text)
 *   streamTerminalOutput(id, cb, signal?)  → unsubscribe fn
 */

import { randomBytes } from 'crypto';
import { listAvailableShells } from './shell-discovery.js';
import { TerminalInstance }    from './terminal-instance.js';

export { listAvailableShells };

// ── Registry ──────────────────────────────────────────────────────────────────

/** @type {Map<string, TerminalInstance>} */
const _terminals = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Spawn a new PTY-backed interactive shell.
 *
 * @param {{ label?: string; shell?: string; cwd?: string }} [opts]
 * @returns {TerminalInstance}
 */
export function createTerminal({ label, shell, cwd } = {}) {
  const id   = `term_${randomBytes(4).toString('hex')}`;
  const term = new TerminalInstance(id, { label, shell, cwd });
  _terminals.set(id, term);
  return term;
}

/**
 * Look up a terminal by id.
 * @param {string} id
 * @returns {TerminalInstance | null}
 */
export function getTerminal(id) {
  return _terminals.get(id) ?? null;
}

/**
 * Return serialisable info for all registered terminals.
 * @returns {ReturnType<TerminalInstance['info']>[]}
 */
export function listTerminalEntries() {
  return [..._terminals.values()].map(t => t.info());
}

/**
 * Kill and deregister a terminal.
 * Guaranteed not to throw — safe to call multiple times or on terminals
 * whose PTY process never started (e.g. node-pty spawn failure).
 * @param {string} id
 * @returns {boolean} false if the id was not found
 */
export function removeTerminal(id) {
  const term = _terminals.get(id);
  if (!term) return false;
  try { term.kill(); } catch { /* PTY already gone or never started */ }
  _terminals.delete(id);
  return true;
}

/**
 * Resize the PTY viewport of a terminal.
 * @param {string} id
 * @param {number} cols
 * @param {number} rows
 */
export function resizeTerminal(id, cols, rows) {
  const term = _terminals.get(id);
  if (!term) throw new Error(`Terminal "${id}" not found`);
  term.resize(cols, rows);
}

/**
 * Write text (or a control byte such as \x03) directly to the PTY.
 * @param {string} id
 * @param {string} text
 */
export function writeToTerminal(id, text) {
  const term = _terminals.get(id);
  if (!term) throw new Error(`Terminal "${id}" not found`);
  term.write(text);
}

/**
 * Subscribe a callback to real-time PTY output.
 * `onData({ text, done, exitCode? })` is called for each chunk and once on exit.
 * Returns an unsubscribe function; also cancelled when `signal` aborts.
 *
 * @param {string} id
 * @param {(evt: { text: string; done: boolean; exitCode?: number }) => void} onData
 * @param {AbortSignal} [signal]
 * @returns {() => void}
 */
export function streamTerminalOutput(id, onData, signal) {
  const term = _terminals.get(id);
  if (!term) throw new Error(`Terminal "${id}" not found`);
  const unsub = term.subscribe(onData);
  signal?.addEventListener('abort', unsub, { once: true });
  return unsub;
}

/**
 * Kill and deregister ALL terminal sessions.
 * Used by the plugin deactivation lifecycle — symmetric to activate().
 * Safe to call multiple times; terminals already killed are skipped.
 */
export function killAllTerminals() {
  const ids = Array.from(_terminals.keys());
  for (const id of ids) {
    removeTerminal(id);
  }
}

// ── Cleanup on server exit ────────────────────────────────────────────────────
process.on('exit', () => {
  for (const term of _terminals.values()) term.kill();
});
