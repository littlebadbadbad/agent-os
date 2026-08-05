/**
 * CommandSession — a lightweight command execution wrapper.
 *
 * Unlike TerminalInstance (which uses node-pty for interactive shells),
 * CommandSession uses child_process.spawn({ shell: true }) for running
 * arbitrary commands (npx, python, node scripts, etc.).  This is essential
 * on Windows where .cmd/.bat batch files can only be executed through a
 * shell — node-pty cannot resolve them directly.
 *
 * The session provides the same read/write surface as TerminalInstance:
 *   write(text) → child.stdin
 *   read(fromOffset) → accumulated stdout+stderr buffer
 *   subscribe(fn) → real-time output events
 *   kill() → terminate the process
 *   info() → serialisable metadata
 *
 * Registered in the same terminal registry so it appears in the terminal
 * panel alongside interactive shells.
 */

import { spawn } from 'child_process';

/** @param {string | Buffer} chunk */
function toString(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
}

export class CommandSession {
  /** @type {string} */
  #id;
  /** @type {string} */
  #label;
  /** @type {string} */
  #commandLine;
  /** @type {string | null} */
  #cwd;
  /** @type {import('child_process').ChildProcess | null} */
  #child = null;
  /** @type {string} */
  #buf = '';
  /** @type {number} */
  #absOffset = 0;
  /** @type {number} */
  #maxBuf = 2 * 1024 * 1024;
  /** @type {boolean} */
  #running = false;
  /** @type {number | undefined} */
  #exitCode;
  /** @type {string} */
  #createdAt = new Date().toISOString();
  /** @type {Set<function>} */
  #subscribers = new Set();

  /**
   * @param {string} id
   * @param {{ commandLine: string; label?: string; cwd?: string }} opts
   */
  constructor(id, { commandLine, label, cwd }) {
    this.#id = id;
    this.#commandLine = commandLine;
    this.#label = label ?? commandLine.slice(0, 40);
    this.#cwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : null;
    this.#spawn();
  }

  #spawn() {
    try {
      this.#child = spawn(this.#commandLine, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: this.#cwd ?? undefined,
        env: process.env,
      });
    } catch (err) {
      this.#running = false;
      this.#exitCode = -1;
      const msg = `\r\n[command error: ${err.message}]\r\n`;
      this.#buf += msg;
      this.#absOffset += msg.length;
      setImmediate(() => this.#notifyDone(-1));
      return;
    }

    this.#running = true;

    this.#child.on('error', (err) => {
      const msg = `\r\n[command error: ${err.message}]\r\n`;
      this.#buf += msg;
      this.#absOffset += msg.length;
      this.#notifyChunk(msg);
    });

    this.#child.stdout?.on('data', (chunk) => {
      const text = toString(chunk);
      this.#buf += text;
      this.#absOffset += text.length;
      this.#trimBuf();
      this.#notifyChunk(text);
    });

    this.#child.stderr?.on('data', (chunk) => {
      const text = toString(chunk);
      this.#buf += text;
      this.#absOffset += text.length;
      this.#trimBuf();
      this.#notifyChunk(text);
    });

    this.#child.on('exit', (code, _signal) => {
      this.#running = false;
      this.#exitCode = code ?? undefined;
      this.#notifyDone(this.#exitCode);
    });
  }

  #trimBuf() {
    if (this.#buf.length > this.#maxBuf) {
      this.#buf = this.#buf.slice(this.#buf.length - this.#maxBuf);
    }
  }

  /** @param {string} text */
  #notifyChunk(text) {
    for (const fn of this.#subscribers) {
      try { fn({ text, done: false }); } catch { /* ignore */ }
    }
  }

  /** @param {number | undefined} exitCode */
  #notifyDone(exitCode) {
    const code = exitCode ?? (this.#exitCode ?? 0);
    for (const fn of this.#subscribers) {
      try { fn({ text: '', done: true, exitCode: code }); } catch { /* ignore */ }
    }
    this.#subscribers.clear();
  }

  /**
   * Write raw bytes to the process stdin.
   * @param {string} text
   */
  write(text) {
    if (!this.#running || !this.#child?.stdin?.writable) {
      throw new Error(`Command has already exited (exitCode=${this.#exitCode ?? 'unknown'})`);
    }
    this.#child.stdin.write(text);
  }

  /**
   * Read accumulated output since `fromOffset` (pass 0 for the full buffer).
   * @param {number} [fromOffset]
   * @returns {{ output: string; offset: number; running: boolean; exitCode?: number }}
   */
  read(fromOffset = 0) {
    const bufStart = this.#absOffset - this.#buf.length;
    const sliceFrom = Math.max(0, fromOffset - bufStart);
    return {
      output: this.#buf.slice(sliceFrom),
      offset: this.#absOffset,
      running: this.#running,
      exitCode: this.#exitCode,
    };
  }

  /**
   * Subscribe to output events.
   * @param {function} fn  — ({ text, done, exitCode? }) => void
   * @returns {() => void}
   */
  subscribe(fn) {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /** Kill the child process. */
  kill() {
    if (!this.#running || !this.#child) return;
    this.#running = false;
    this.#exitCode = -1;
    this.#notifyDone(-1);
    try { this.#child.kill(); } catch { /* ignore */ }
  }

  /** Serialisable summary. */
  info() {
    return {
      id: this.#id,
      label: this.#label,
      shell: this.#commandLine,
      cwd: this.#cwd,
      running: this.#running,
      exitCode: this.#exitCode,
      createdAt: this.#createdAt,
      outputBytes: this.#absOffset,
    };
  }

  get id() { return this.#id; }
  get running() { return this.#running; }
}
