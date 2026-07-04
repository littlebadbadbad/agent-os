/**
 * TerminalInstance — a single interactive PTY-backed shell session.
 *
 * Uses node-pty to spawn a real pseudo-terminal on every platform:
 *   Windows  →  ConPTY (Windows 10 1903+) with winpty fallback
 *   Unix     →  POSIX PTY via openpty / forkpty
 *
 * Because a genuine PTY is present, the OS line discipline handles all
 * control-character translation transparently:
 *   \x03  →  SIGINT  to the foreground process group  (Ctrl+C)
 *   \x04  →  EOF     to the reading process            (Ctrl+D)
 *   \x1A  →  SIGTSTP (Unix only)                       (Ctrl+Z)
 *   \x0C  →  clear-screen sequence emitted by the shell (Ctrl+L)
 *
 * No application-level signal routing is required — writing the raw byte
 * to write() is sufficient on every supported OS.
 *
 * Output arrives as decoded strings from node-pty (the PTY layer handles
 * encoding).  The accumulated ring buffer stores the raw text including
 * ANSI escape sequences; consumers such as TerminalPanel strip them before
 * display.
 */

import pty from 'node-pty';
import { IS_WIN } from './shell-discovery.js';

/** Default PTY viewport — wide enough for most shell output. */
const DEFAULT_COLS = 220;
const DEFAULT_ROWS = 50;

export class TerminalInstance {
  #id;
  #label;
  #shell;
  #args;
  #cwd;
  #currentCwd;
  #pty;
  #buf        = '';
  #absOffset  = 0;
  #maxBuf     = 2 * 1024 * 1024; // 2 MB ring buffer
  #running    = false;
  #exitCode;
  #createdAt  = new Date().toISOString();
  #subscribers = new Set();

  /**
   * @param {string} id - Unique identifier for this terminal instance.
   * @param {{ label?: string; shell?: string; cwd?: string }} [opts]
   */
  constructor(id, { label, shell, cwd } = {}) {
    this.#id  = id;
    this.#cwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined;

    const resolved = shell ?? (IS_WIN ? 'cmd.exe' : (process.env.SHELL ?? 'bash'));
    // Support inline args: "pwsh -NoProfile" → shell=pwsh, args=['-NoProfile']
    const parts = resolved.trim().split(/\s+/);
    this.#shell = parts[0];
    this.#args  = parts.slice(1);
    this.#label      = label ?? resolved.split(/[\\/]/).pop();
    this.#currentCwd = this.#cwd ?? null;

    this.#spawn();
  }

  #spawn() {
    // node-pty throws synchronously when the shell binary is not found
    // (ENOENT / "File not found"), unlike child_process which emits 'error'
    // asynchronously.  Catch here and schedule the error notification on the
    // next tick so that callers can attach subscribers before they fire.
    try {
      const spawnEnv = { ...process.env };
      // Inject OSC 7 (cwd notification) into bash-family shells via PROMPT_COMMAND.
      // The sequence \033]7;file://$HOSTNAME$PWD\007 is the de-facto standard.
      if (/bash/.test(this.#shell)) {
        const osc7 = String.raw`printf '\033]7;file://%s%s\007' "$HOSTNAME" "$PWD"`;
        spawnEnv.PROMPT_COMMAND = spawnEnv.PROMPT_COMMAND
          ? `${osc7};${spawnEnv.PROMPT_COMMAND}`
          : osc7;
      }

      this.#pty = pty.spawn(this.#shell, this.#args, {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd:  this.#cwd ?? process.cwd(),
        env:  spawnEnv,
        // On Windows, ConPTY has a known bug (observed on Win10 21H2 / build
        // 19044) where the output pipe stops delivering data events after the
        // initial full-screen buffer flush.  The result: the first shell banner
        // arrives but every subsequent command's output is silently buffered
        // in the ConPTY and never pushed to subscribers.
        // Switching to WinPTY (useConpty: false) avoids the issue entirely.
        // On non-Windows this option is ignored by node-pty.
        useConpty: false,
      });
    } catch (err) {
      this.#running  = false;
      this.#exitCode = -1;
      const msg = `\r\n[terminal error: ${err.message}]\r\n`;
      this.#buf       += msg;
      this.#absOffset += msg.length;
      // Defer so callers have a chance to subscribe before events fire.
      setImmediate(() => {
        for (const fn of this.#subscribers) {
          try { fn({ text: msg, done: false }); } catch {}
          try { fn({ text: '', done: true, exitCode: -1 }); } catch {}
        }
        this.#subscribers.clear();
      });
      return;
    }
    this.#running = true;

    // OSC 7 pattern: ESC ] 7 ; file://hostname/path BEL
    const OSC7_RE = /\x1b]7;file:\/\/[^/]*([^\x07]*)\x07/g;

    // Suppress node-pty errors gracefully — the PTY may emit 'error' during
    // kill() if the child process has already terminated.  Without this handler
    // the error becomes an unhandled exception that vitest catches in afterEach
    // hooks, causing spurious test failures.
    this.#pty.on('error', () => {});

    this.#pty.on('data', (data) => {
      // Parse OSC 7 CWD notifications before buffering.
      let m;
      OSC7_RE.lastIndex = 0;
      while ((m = OSC7_RE.exec(data)) !== null) {
        try { this.#currentCwd = decodeURIComponent(m[1]); } catch {}
      }

      this.#buf       += data;
      this.#absOffset += data.length;
      if (this.#buf.length > this.#maxBuf) {
        this.#buf = this.#buf.slice(this.#buf.length - this.#maxBuf);
      }
      for (const fn of this.#subscribers) {
        try { fn({ text: data, done: false }); } catch {}
      }
    });

    // node-pty 1.x emits exit with an object { exitCode, signal? }.
    // Earlier versions used two separate arguments. Support both.
    this.#pty.on('exit', (codeOrObj, legacySignal) => {
      this.#running  = false;
      const exitCode = (typeof codeOrObj === 'object' && codeOrObj !== null)
        ? codeOrObj.exitCode
        : codeOrObj;
      const signal   = (typeof codeOrObj === 'object' && codeOrObj !== null)
        ? codeOrObj.signal
        : legacySignal;
      this.#exitCode = exitCode ?? (signal != null ? -1 : 0);

      for (const fn of this.#subscribers) {
        try { fn({ text: '', done: true, exitCode: this.#exitCode }); } catch {}
      }
      this.#subscribers.clear();
    });
  }

  /**
   * Write raw bytes to the PTY.
   *
   * The OS line discipline translates control characters — no special-casing
   * needed at the application level:
   *   Ctrl+C (\x03) → SIGINT  to the foreground process group
   *   Ctrl+D (\x04) → EOF     to the reading process
   *   Ctrl+Z (\x1A) → SIGTSTP on Unix (suspends foreground job)
   *
   * @param {string} text
   */
  write(text) {
    if (!this.#running) {
      throw new Error(`Terminal has already exited (exitCode=${this.#exitCode ?? 'unknown'})`);
    }
    // In a PTY, "Enter" is \r (CR, 0x0D) — not \n (LF, 0x0A).
    // The keyboard always sends \r; the PTY line discipline echoes \r\n and
    // delivers \n to the application.  Callers (HTTP frontend, agent tools)
    // conventionally append \n, which Windows ConPTY silently ignores, so
    // commands appear typed but never execute.
    //
    // Normalize: on Windows replace every \r?\n with \r so that callers can
    // always write \n and have it work regardless of platform.
    // On Unix, both \r and \n are accepted by the PTY, so no conversion needed.
    this.#pty.write(IS_WIN ? text.replace(/\r?\n/g, '\r') : text);
  }

  /**
   * Resize the PTY viewport.  No-op after exit.
   * @param {number} cols
   * @param {number} rows
   */
  resize(cols, rows) {
    if (this.#running) {
      try { this.#pty.resize(cols, rows); } catch {}
    }
  }

  /**
   * Subscribe to output events.
   * `fn({ text, done, exitCode? })` is called for every new chunk and once
   * with `done: true` when the shell exits.
   * Returns an unsubscribe function.
   *
   * @param {(evt: { text: string; done: boolean; exitCode?: number }) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /**
   * Read accumulated output since `fromOffset` (pass 0 for the full buffer).
   * @param {number} [fromOffset]
   */
  read(fromOffset = 0) {
    const bufStart  = this.#absOffset - this.#buf.length;
    const sliceFrom = Math.max(0, fromOffset - bufStart);
    return {
      output:   this.#buf.slice(sliceFrom),
      offset:   this.#absOffset,
      running:  this.#running,
      exitCode: this.#exitCode,
    };
  }

  /** Kill the PTY process.  node-pty handles cross-platform termination. */
  kill() {
    if (!this.#running) return;
    try { this.#pty.kill(); } catch {}
  }

  /** Serialisable summary of this terminal's current state. */
  info() {
    return {
      id:          this.#id,
      label:       this.#label,
      shell:       this.#shell,
      cwd:         this.#currentCwd ?? null,
      running:     this.#running,
      exitCode:    this.#exitCode,
      createdAt:   this.#createdAt,
      outputBytes: this.#absOffset,
    };
  }

  get id()      { return this.#id; }
  get running() { return this.#running; }
}
