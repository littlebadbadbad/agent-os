// ── VersionInfo / BuildResult ────────────────────────────────────────────────

export type VersionInfo = {
  readonly version: string;
};

/**
 * Returned immediately after `build()` — the build is running in the background.
 * Poll the terminal via `readTerminalOutput` to detect completion.
 */
export type BuildResult = {
  /** ID of the terminal executing the build command. */
  terminalId: string;
};

/** Output snapshot from a running or completed terminal. */
export type TerminalSnapshot = {
  output: string;
  offset: number;
  running: boolean;
  exitCode?: number;
};

export type DevServerStatus = {
  running: boolean;
  url?: string;
  terminalId?: string;
};

export type DevStartResult = {
  url: string;
  terminalId: string;
  alreadyRunning: boolean;
};

export type TestResult = {
  /** Whether the test command was started. */
  started: boolean;
  /** ID of the terminal executing the test command. */
  terminalId: string;
};

// ── UpgradeAdapter ────────────────────────────────────────────────────────────

export type UpgradeAdapter = {
  /** Fetch the running server's current version string. */
  getVersion(): Promise<VersionInfo>;

  /**
   * Start `pnpm build:exe` in the background and return the terminal ID
   * immediately.  The build continues asynchronously — use `readTerminalOutput`
   * to poll progress and detect completion.
   *
   * @param opts.terminalId  Write the command into this existing terminal.
   *                         A new one-shot terminal is created when omitted.
   */
  build(opts?: { terminalId?: string }): Promise<BuildResult>;

  /**
   * Read accumulated output from a terminal.  Pass `offset` to continue from
   * the last position (cursor advances with each call); pass `0` to re-read
   * from the start.
   */
  readTerminalOutput(terminalId: string, offset: number): Promise<TerminalSnapshot>;

  /**
   * Write raw bytes to a terminal's stdin.
   *
   * Primarily used to send Ctrl+C (`'\x03'`) when a running build times out,
   * matching the behaviour of `terminal_wait`'s hard-timeout path.
   * Implementations should silently succeed if the terminal is no longer running.
   */
  sendTerminalInput(terminalId: string, text: string): Promise<void>;

  /**
   * Send the restart signal to the server.
   *
   * The server sends a `200 { status: 'restarting' }` response, then exits
   * with `RESTART_CODE` (75) after a 1-second grace period.  The connection
   * may close before the response arrives — implementations should treat
   * network errors as a successful trigger.
   *
   * Only meaningful when running as a packaged executable (pkg mode).
   */
  restart(): Promise<void>;

  /** Start the frontend dev server. Returns the dev URL once ready. */
  devStart(signal?: AbortSignal): Promise<DevStartResult>;

  /** Stop the frontend dev server (if running). */
  devStop(): Promise<void>;

  /** Query dev server state without starting or stopping it. */
  devStatus(): Promise<DevServerStatus>;

  /**
   * Run vitest or tsc type-check for the given target.
   *
   * @param opts.target  `'backend'` → vitest.config.ts; `'sdk'` → vitest.sdk.config.ts;
   *                     `'typecheck'` → tsc --noEmit
   * @param opts.args    Extra CLI arguments (filters, --coverage, …). Ignored for typecheck.
   */
  runTests(opts: { target: 'backend' | 'sdk' | 'typecheck'; args?: string[]; terminalId?: string }): Promise<TestResult>;

  /**
   * Present a yes/no confirmation to the user.
   *
   * Used in tool lifecycle hooks where `context.requestUserInput` is not
   * available (e.g. pre-restart prompt in headless mode, `onSessionReady`
   * fallback after restart).
   *
   * Returns `true` for yes, `false` for no, `null` if cancelled or unavailable.
   */
  confirm(message: string): Promise<boolean | null>;
};
