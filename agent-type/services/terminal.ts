/**
 * agent-type/services/terminal.ts — Terminal service type contract
 *
 * Defines the shape of the `'terminal'` service that the terminal plugin
 * registers on the backend host's PluginServiceRegistry during activation.
 *
 * Other backend plugins (e.g., MCP for stdio transport) resolve this service
 * to create and manage terminal sessions programmatically — without going
 * through the agent layer or HTTP/IPC transport.
 */

// ── Data types ───────────────────────────────────────────────────────────────

/** Metadata for a single interactive terminal instance. */
export interface TerminalSessionInfo {
  /** Stable unique identifier. */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /** Shell executable path. */
  readonly shell: string;
  /** Current working directory, or null. */
  readonly cwd: string | null;
  /** Whether the shell process is still alive. */
  readonly running: boolean;
  /** Exit code when `running === false`. */
  readonly exitCode: number | null;
  /** ISO-8601 timestamp of creation. */
  readonly createdAt: string;
  /** Total bytes of output accumulated. */
  readonly outputBytes: number;
}

/** A shell available on the backend host. */
export interface AvailableShellInfo {
  /** Shell binary name (e.g., `'cmd.exe'`, `'pwsh'`). */
  readonly name: string;
  /** Resolved absolute path. */
  readonly path: string;
  /** `true` for the default shell. */
  readonly isDefault: boolean;
}

/** Parameters for creating a terminal session. */
export interface CreateTerminalParams {
  /** Custom display label. */
  readonly label?: string;
  /** Shell executable override. */
  readonly shell?: string;
  /** Working directory. */
  readonly cwd?: string;
}

/** Parameters for running a command via shell. */
export interface SpawnCommandParams {
  /** Full command line (e.g. "npx -y @org/mcp-server"). */
  readonly commandLine: string;
  /** Custom display label. */
  readonly label?: string;
  /** Working directory. */
  readonly cwd?: string;
}

/** Parameters for sending input to a terminal. */
export interface SendInputParams {
  /** Terminal session id. */
  readonly id: string;
  /** Text to write (append `'\n'` for command, `'\x03'` for Ctrl+C). */
  readonly text: string;
}

/** Parameters for reading buffered output. */
export interface ReadOutputParams {
  /** Terminal session id. */
  readonly id: string;
  /** Byte offset to read from (0 for start, returned offset for incremental). */
  readonly fromOffset?: number;
}

/** Buffered output snapshot. */
export interface ReadOutputResult {
  /** The output text since `fromOffset`. */
  readonly output: string;
  /** Next offset to pass for incremental reads. */
  readonly offset: number;
  /** Whether the process is still running. */
  readonly running: boolean;
  /** Exit code when not running. */
  readonly exitCode?: number;
}

/** Parameters for resizing a PTY. */
export interface ResizeParams {
  /** Terminal session id. */
  readonly id: string;
  /** Number of columns. */
  readonly cols: number;
  /** Number of rows. */
  readonly rows: number;
}

/** Parameters for waiting on a terminal. */
export interface WaitParams {
  /** Terminal session id. */
  readonly id: string;
  /** Idle threshold in milliseconds. */
  readonly idleMs?: number;
  /** Hard timeout in milliseconds (triggers Ctrl+C). */
  readonly timeoutMs?: number;
}

/** Result of a wait operation. */
export interface WaitResult {
  /** Buffered output at the time the wait ended. */
  readonly output: string;
  /** Offset for incremental reads. */
  readonly offset: number;
  /** Whether the process was still running when wait ended. */
  readonly running: boolean;
  /** Exit code if the process exited. */
  readonly exitCode?: number;
  /** Whether the hard timeout was exceeded. */
  readonly timedOut: boolean;
  /** Why the wait ended. */
  readonly reason: 'idle' | 'exited' | 'timeout' | 'cancelled';
}

/** Result of a sleep operation. */
export interface SleepResult {
  /** Actual milliseconds slept. */
  readonly slept: number;
  /** Whether the sleep was aborted. */
  readonly aborted: boolean;
}

// ── runCommand (high-level convenience) ──────────────────────────────────────

/** Parameters for {@link TerminalService.runCommand}. */
export interface RunCommandParams {
  /** Executable name (e.g. `'git'`, `'pnpm'`, `'npx'`). */
  readonly command: string;
  /** Arguments passed to the command. Each arg is shell-quoted automatically. */
  readonly args?: readonly string[];
  /** Working directory. */
  readonly cwd?: string;
  /** Hard timeout in ms (default 120 000). Sends Ctrl+C on expiry. */
  readonly timeoutMs?: number;
}

/** Synchronous result of {@link TerminalService.runCommand}. */
export interface RunCommandResult {
  /** Combined stdout + stderr output. */
  readonly output: string;
  /** Process exit code (`-1` on error or timeout). */
  readonly exitCode: number;
  /** `true` when `exitCode === 0`. */
  readonly success: boolean;
  /** `true` when the hard timeout was exceeded. */
  readonly timedOut: boolean;
}

// ── subscribeTerminalOutput ──────────────────────────────────────────────────

/** Parameters for subscribing to real-time terminal output. */
export interface SubscribeOutputParams {
  /** Terminal session id. */
  readonly id: string;
  /** Called for every new output chunk. */
  readonly onOutput: (text: string) => void;
  /** Called when the process exits. */
  readonly onDone: (exitCode: number | null) => void;
  /** Optional abort signal — when aborted, the subscription is removed. */
  readonly signal?: AbortSignal;
}

// ── Service interface ────────────────────────────────────────────────────────

/**
 * Terminal management service exposed by the terminal plugin.
 *
 * Registered as `'terminal'` on {@link PluginServiceRegistry} during backend
 * activation.  Other backend plugins resolve this to create and control
 * terminal sessions without agent-layer overhead.
 */
export interface TerminalService {
  /** List all active terminal sessions. */
  listTerminals(): { readonly terminals: readonly TerminalSessionInfo[] };

  /** List shells available on the host. */
  availableShells(): { readonly shells: readonly AvailableShellInfo[] };

  /** Create a new interactive terminal session. */
  createTerminalSession(params: CreateTerminalParams): TerminalSessionInfo;

  /**
   * Run an arbitrary command via child_process.spawn({ shell: true }).
   *
   * Unlike `createTerminalSession` (node-pty), this handles .cmd/.bat on
   * Windows and arbitrary command lines — essential for npx, python, node.
   * Returns the same info shape as createTerminalSession.
   */
  spawnCommand(params: SpawnCommandParams): TerminalSessionInfo;

  /**
   * Run a command to completion and return the result.
   *
   * High-level convenience that wraps `spawnCommand` + `waitTerminal` +
   * `readTerminalOutput` + `removeTerminalSession`.  Arguments are
   * shell-quoted automatically — callers pass them as an array, never as
   * a pre-joined string.
   *
   * The session is removed after completion so no orphaned terminals
   * accumulate.
   */
  runCommand(params: RunCommandParams): Promise<RunCommandResult>;

  /** Kill and remove a terminal session. */
  removeTerminalSession(params: { readonly id: string }): { readonly ok: true };

  /** Write text to a terminal's stdin. */
  sendTerminalInput(params: SendInputParams): { readonly ok: true };

  /** Read buffered output since a given offset. */
  readTerminalOutput(params: ReadOutputParams): ReadOutputResult;

  /** Resize a PTY's dimensions. */
  resizeTerminalSession(params: ResizeParams): void;

  /** Wait for a terminal to become idle or exit. */
  waitTerminal(params: WaitParams): Promise<WaitResult>;

  /** Server-side sleep (no agent-process blocking). */
  sleepTerminal(params: { readonly durationMs: number }): Promise<SleepResult>;

  /** Cancel an active waitTerminal call. */
  cancelWait(params: { readonly id: string }): void;

  /**
   * Subscribe to real-time output events from a terminal session.
   * Returns immediately — callbacks fire asynchronously as output arrives.
   */
  subscribeTerminalOutput(params: SubscribeOutputParams): void;
}
