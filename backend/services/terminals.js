/**
 * backend/lib/services/terminals.js — Terminal business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here: validation, formatting, error handling.
 */

import {
  createTerminal,
  getTerminal,
  listTerminalEntries,
  removeTerminal,
  writeToTerminal,
  resizeTerminal,
  listAvailableShells,
  streamTerminalOutput,
} from '../lib/shell-manager/index.js';

export function listTerminals() {
  return { terminals: listTerminalEntries() };
}

export function availableShells() {
  return listAvailableShells();
}

export function createTerminalSession({ label, shell, cwd } = {}) {
  // Resolve bare shell name to full path
  if (shell) {
    const firstName = shell.trim().split(/\s+/)[0];
    const available = listAvailableShells();
    const match = available.find(
      s => s.name === firstName || s.path === firstName ||
           s.path.toLowerCase() === firstName.toLowerCase(),
    );
    if (match) {
      const restArgs = shell.trim().slice(firstName.length);
      shell = match.path + restArgs;
    }
  }
  const term = createTerminal({ label, shell, cwd });
  return term.info();
}

export function removeTerminalSession({ id }) {
  if (!id) throw new Error('id is required');
  removeTerminal(id);
  return { ok: true };
}

export function sendTerminalInput({ id, text }) {
  if (!id) throw new Error('id is required');
  if (text === undefined || text === null) throw new Error('text is required');
  writeToTerminal(id, text);
  return { ok: true };
}

export function readTerminalOutput({ id, fromOffset }) {
  if (!id) throw new Error('id is required');
  const term = getTerminal(id);
  if (!term) throw new Error(`Terminal "${id}" not found`);
  return term.read(fromOffset ?? 0);
}

/**
 * Get a terminal session instance — throws if not found.
 * Use this instead of calling getTerminal() + null check in transport layers.
 * @returns {object} TerminalInstance
 */
export function getTerminalSession({ id }) {
  if (!id) throw new Error('id is required');
  const term = getTerminal(id);
  if (!term) throw new Error(`Terminal "${id}" not found`);
  return term;
}

export function resizeTerminalSession({ id, cols, rows }) {
  if (!id) throw new Error('id is required');
  resizeTerminal(id, cols, rows);
  return { ok: true };
}

/**
 * Subscribe to real-time terminal output via a callback.
 * @param {{ id: string, onOutput: (text: string) => void, onDone: (exitCode: number | null) => void, signal: AbortSignal }} opts
 * @returns {void}
 */
export function subscribeTerminalOutput({ id, onOutput, onDone, signal }) {
  if (!id) throw new Error('id is required');
  streamTerminalOutput(id, ({ text, done, exitCode }) => {
    if (text) onOutput(text);
    if (done) onDone(exitCode ?? null);
  }, signal);
}
