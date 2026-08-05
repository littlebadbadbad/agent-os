/**
 * internal-plugins/terminal/agent/shell/types.ts — Terminal ToolSet type definitions
 *
 * Defines the TerminalManagerAdapter interface, shell families, and
 * data types for terminal entries and output snapshots.
 *
 * Moved from agent/types.ts during plugin restructuring (Phase 1).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * High-level shell family — derived from the shell binary name.
 * Use this to decide command syntax when writing to a terminal:
 *  - `'powershell'` → `$var`, `Get-Item`, `;` separator
 *  - `'cmd'`        → `%VAR%`, `dir`, `&&` / `&` separators
 *  - `'bash'`       → `$var`, POSIX commands, `;` / `&&`
 *  - `'zsh'`        → same as bash, with zsh internal-plugins
 *  - `'fish'`       → `$var`, fish builtins, `;` separator
 *  - `'unknown'`    → cannot be determined
 */
export type ShellFamily = 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'unknown';

/** Metadata for a single interactive terminal instance. */
export interface TerminalEntry {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable label (defaults to the shell binary name). */
  label: string;
  /** Shell executable, e.g. `'cmd.exe'`, `'bash'`, `'pwsh'`. */
  shell: string;
  /**
   * Normalised shell family — use this to choose correct command syntax.
   * See `ShellFamily` for per-family syntax notes.
   */
  shellFamily: ShellFamily;
  /** Current working directory of the shell process (dynamically updated via OSC 7), or null. */
  cwd: string | null;
  /** Whether the shell process is still alive. */
  running: boolean;
  /** Exit code when `running === false`. */
  exitCode?: number;
  /** ISO-8601 timestamp of when this terminal was created. */
  createdAt: string;
  /** Total bytes of output accumulated so far. */
  outputBytes: number;
}

/** A shell executable available on the backend host. */
export interface AvailableShell {
  /** Shell binary name, e.g. `'cmd.exe'`, `'pwsh'`, `'bash'`. */
  name: string;
  /** Resolved absolute path on the backend host. */
  path: string;
  /** `true` for whichever shell would be used when no `shell` option is passed to `createTerminal`. */
  isDefault: boolean;
}

/**
 * Buffered output snapshot — used by agents to inspect a terminal's history
 * without opening a live stream.
 */
export interface TerminalOutput {
  output: string;
  /**
   * Pass as `fromOffset` in the next `readOutput()` call for incremental
   * reads (avoids re-reading output already seen).
   */
  offset: number;
  running: boolean;
  exitCode?: number;
}

/**
 * Extended result from a wait-for-idle-or-exit operation.
 * Includes the full output snapshot plus the reason the wait ended.
 */
export interface WaitResult extends TerminalOutput {
  /** Whether the hard timeout was exceeded (Ctrl+C was sent). */
  timedOut: boolean;
  /** Why the wait ended. */
  reason: 'idle' | 'exited' | 'timeout' | 'cancelled';
}

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Dependency-injection contract for the terminal panel UI and any agent code
 * that needs to inspect running terminals.
 */
export interface TerminalManagerAdapter {
  /**
   * Return active terminal instances.
   * @param opts.sessionId  When supplied, the adapter may filter to only return
   *                        terminals that belong to this session.
   */
  listTerminals(opts: { sessionId: string }): Promise<TerminalEntry[]>;

  /** Return the shells available on the backend host (for autocomplete). */
  listShells(): Promise<AvailableShell[]>;

  /**
   * Create a new interactive terminal shell.
   * @param opts.shell      Shell executable override (default: `cmd.exe` / `bash`).
   * @param opts.label      Custom display label.
   * @param opts.cwd        Working directory to start the shell in.
   * @param opts.sessionId  Tag the terminal with a session ID for grouping/filtering.
   */
  createTerminal(opts: {
    label?: string;
    shell?: string;
    cwd?: string;
    sessionId: string;
  }): Promise<TerminalEntry>;

  /**
   * Kill (if running) and remove a terminal from the registry.
   * The terminal's SSE stream will receive a `done` event before closing.
   */
  removeTerminal(id: string, sessionId: string): Promise<void>;

  /**
   * Write text to the terminal's stdin.
   * Append `'\n'` for a command, or send raw control bytes (e.g. `'\x03'` for Ctrl+C).
   */
  sendInput(id: string, text: string, sessionId: string): Promise<void>;

  /**
   * Read buffered output since `fromOffset`.
   * Pass `0` on the first call; pass the returned `offset` for incremental reads.
   */
  readOutput(id: string, fromOffset: number, sessionId: string): Promise<TerminalOutput>;

  /**
   * Subscribe to real-time output via streaming.
   * `onData(chunk, done, exitCode?)` is called for every new output chunk.
   * Returns an unsubscribe function.
   */
  streamOutput(
    id: string,
    onData: (chunk: string, done: boolean, exitCode?: number) => void,
    sessionId: string,
  ): () => void;

  /**
   * Resize the PTY dimensions.
   */
  resizePty(id: string, cols: number, rows: number, sessionId: string): Promise<void>;

  /**
   * Server-side wait: polls until the terminal becomes idle, exits, or
   * a hard timeout elapses.  The agent tool delegates to this so no
   * polling crosses the wire.
   */
  waitTerminal(
    id: string,
    opts: { idleMs?: number; timeoutMs?: number },
    sessionId: string,
  ): Promise<WaitResult>;

  /**
   * Cancel an active waitTerminal() call for the given terminal.
   * The in-flight `waitTerminal` promise resolves with reason 'cancelled'.
   */
  cancelWait(id: string, sessionId: string): Promise<void>;

  /**
   * Server-side sleep.  Resolves after `durationMs` milliseconds on the
   * backend, so no agent-process blocking occurs.
   */
  sleepTerminal(durationMs: number, sessionId: string): Promise<{ slept: number; aborted: boolean }>;
}
