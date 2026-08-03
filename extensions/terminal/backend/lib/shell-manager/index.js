/**
 * shell-manager — public API for interactive terminal management.
 *
 * Thin coordination layer on top of:
 *   shell-discovery     — host shell enumeration
 *   terminal-instance   — PTY-backed TerminalInstance (interactive shells)
 *   command-session     — child_process.spawn wrapper (arbitrary commands)
 *
 * Both TerminalInstance and CommandSession share the same registry and
 * expose identical read/write/subscribe/info/kill surfaces.
 */

import { randomBytes } from 'crypto';
import { listAvailableShells } from './shell-discovery.js';
import { TerminalInstance }    from './terminal-instance.js';
import { CommandSession }      from './command-session.js';

export { listAvailableShells };

/** @typedef {TerminalInstance | CommandSession} Session */

// ── Unified session registry ──────────────────────────────────────────────────

/** @type {Map<string, Session>} */
const _sessions = new Map();

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
  _sessions.set(id, term);
  return term;
}

/**
 * Run a command via child_process.spawn({ shell: true }).
 *
 * Unlike createTerminal (node-pty), this handles .cmd/.bat on Windows and
 * arbitrary command lines — essential for running npx, python, node scripts.
 *
 * @param {{ commandLine: string; label?: string; cwd?: string }} opts
 * @returns {CommandSession}
 */
export function spawnCommand({ commandLine, label, cwd }) {
  const id  = `cmd_${randomBytes(4).toString('hex')}`;
  const cmd = new CommandSession(id, { commandLine, label, cwd });
  _sessions.set(id, cmd);
  return cmd;
}

/**
 * Look up a session by id.
 * @param {string} id
 * @returns {Session | null}
 */
export function getSession(id) {
  return _sessions.get(id) ?? null;
}

/** Backward-compat alias — all callers go through getSession now. */
export const getTerminal = getSession;

/**
 * Return serialisable info for all registered sessions.
 * @returns {ReturnType<Session['info']>[]}
 */
export function listTerminalEntries() {
  return [..._sessions.values()].map(s => s.info());
}

/**
 * Kill and deregister a session.  Never throws.
 * @param {string} id
 * @returns {boolean}
 */
export function removeTerminal(id) {
  const session = _sessions.get(id);
  if (!session) return false;
  try { session.kill(); } catch { /* already gone */ }
  _sessions.delete(id);
  return true;
}

/**
 * Resize the PTY viewport (no-op for CommandSessions).
 * @param {string} id
 * @param {number} cols
 * @param {number} rows
 */
export function resizeTerminal(id, cols, rows) {
  const session = _sessions.get(id);
  if (!session) throw new Error(`Session "${id}" not found`);
  if (session instanceof TerminalInstance) session.resize(cols, rows);
}

/**
 * Write text to a session's stdin.
 * @param {string} id
 * @param {string} text
 */
export function writeToTerminal(id, text) {
  const session = _sessions.get(id);
  if (!session) throw new Error(`Session "${id}" not found`);
  session.write(text);
}

/**
 * Subscribe a callback to real-time output.
 * @param {string} id
 * @param {(evt: { text: string; done: boolean; exitCode?: number }) => void} onData
 * @param {AbortSignal} [signal]
 * @returns {() => void}
 */
export function streamTerminalOutput(id, onData, signal) {
  const session = _sessions.get(id);
  if (!session) throw new Error(`Session "${id}" not found`);
  const unsub = session.subscribe(onData);
  signal?.addEventListener('abort', unsub, { once: true });
  return unsub;
}

/**
 * Kill and deregister ALL sessions.
 */
export function killAllTerminals() {
  for (const id of Array.from(_sessions.keys())) removeTerminal(id);
}

// ── Cleanup on server exit ────────────────────────────────────────────────────
process.on('exit', () => {
  for (const session of _sessions.values()) session.kill();
});
