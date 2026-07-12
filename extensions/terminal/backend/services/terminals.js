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

/**
 * Server-side sleep.  Resolves after `durationMs` milliseconds unless
 * the AbortSignal fires first.
 *
 * @param {{ durationMs: number, signal?: AbortSignal }} params
 * @returns {Promise<{ slept: number, aborted: boolean }>}
 */
export function sleepTerminal({ durationMs, signal } = {}) {
  if (typeof durationMs !== 'number' || durationMs <= 0) {
    throw new Error('durationMs must be a positive number');
  }
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ slept: Date.now() - started, aborted: false }), durationMs);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve({ slept: Date.now() - started, aborted: true });
      }, { once: true });
    }
  });
}

/**
 * Server-side wait for terminal idle/exit.
 *
 * Polls terminal output until the process exits or output stops for `idleMs`.
 * A hard timeout sends Ctrl+C and returns whatever output was buffered.
 *
 * @param {{ id: string, idleMs?: number, timeoutMs?: number, signal?: AbortSignal }} params
 * @returns {Promise<{ output: string, offset: number, running: boolean, exitCode?: number | null, timedOut: boolean, reason: string }>}
 */
export async function waitTerminal({ id, idleMs = 1000, timeoutMs = 300_000, signal } = {}) {
  if (!id) throw new Error('id is required');

  const pollMs = Math.min(Math.floor(idleMs / 2), 250);
  const deadline = Date.now() + timeoutMs;
  let lastActivityAt = Date.now();
  let lastOffset = 0;

  while (true) {
    if (signal?.aborted) {
      const snap = readTerminalOutput({ id, fromOffset: 0 });
      return { ...snap, timedOut: false, reason: 'aborted' };
    }

    if (Date.now() >= deadline) {
      writeToTerminal(id, '\x03');
      await new Promise(r => setTimeout(r, 300));
      const snap = readTerminalOutput({ id, fromOffset: 0 });
      return { ...snap, timedOut: true, reason: 'timeout' };
    }

    const snap = readTerminalOutput({ id, fromOffset: lastOffset });

    if (snap.output.length > 0) {
      lastActivityAt = Date.now();
      lastOffset = snap.offset;
    }

    if (!snap.running) {
      const full = readTerminalOutput({ id, fromOffset: 0 });
      return { ...full, timedOut: false, reason: 'exited' };
    }

    if (Date.now() - lastActivityAt >= idleMs) {
      const full = readTerminalOutput({ id, fromOffset: 0 });
      return { ...full, timedOut: false, reason: 'idle' };
    }

    await new Promise(r => setTimeout(r, pollMs));
  }
}
