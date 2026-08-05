/**
 * internal-plugins/terminal/agent/upgrade/types.ts — Upgrade ToolSet type system
 *
 * Defines the UpgradePluginAdapter contract, shared types, and
 * module augmentations for session persistence + UI state.
 *
 * Key design: confirm is handled via `context.requestUserInput`, not the adapter.
 * Terminal operations are handled via the co-located terminal plugin adapter.
 */

// ── Side-effect: module augmentations ──────────────────────────────────────

declare module "@agent-type" {
  interface SessionEntryExtension {
    /**
     * Set to `true` immediately before an upgrade restart is triggered.
     * Cleared by UpgradeToolSet on the next session load so the fallback
     * "continue session?" prompt can be surfaced via `onSessionReady`.
     */
    upgradeRestartPending?: true;
  }
}

declare module "@agent-type" {
  interface AgentSessionExtension {
    /** Live version info surfaced to the UI. `undefined` until fetched. */
    upgradeInfo?: VersionInfo;
    /** Dev server URL while the dev server is running. */
    upgradeDevUrl?: string;
    /** Whether the dev server is currently running. */
    upgradeDevRunning?: boolean;
    /** Terminal ID of the running dev server terminal, if any. */
    upgradeDevTerminalId?: string;
    /** Whether upgrade_complete was called this turn (reset on next onBeforeRun). */
    upgradeFrozen?: boolean;
  }
}

export {};

// ── Shared types ───────────────────────────────────────────────────────────

export interface VersionInfo {
  readonly version: string;
}

/** Returned immediately after `build()` — the build is running in the background. */
export interface BuildResult {
  /** ID of the terminal executing the build command. */
  terminalId: string;
}

export interface DevServerStatus {
  running: boolean;
  url?: string;
  terminalId?: string;
}

export interface DevStartResult {
  url: string;
  terminalId: string;
  alreadyRunning: boolean;
}

export interface TestResult {
  /** Whether the test command was started. */
  started: boolean;
  /** ID of the terminal executing the test command. */
  terminalId: string;
}

// ── UpgradePluginAdapter ────────────────────────────────────────────────────

/**
 * Adapter contract for upgrade backend operations.
 *
 * This is a **subset** of the old UpgradeAdapter — terminal operations
 * (readTerminalOutput, sendTerminalInput) and confirm() are removed:
 * - Terminal: upgrade tools directly use co-located terminal plugin APIs
 * - Confirm: exclusively via `context.requestUserInput`
 */
export interface UpgradePluginAdapter {
  /** Fetch the running server's current version string. */
  getVersion(): Promise<VersionInfo>;

  /**
   * Start `pnpm build:exe` in the background and return the terminal ID
   * immediately.  The build continues asynchronously.
   *
   * @param opts.terminalId  Write the command into this existing terminal.
   *                         A new one-shot terminal is created when omitted.
   */
  build(opts?: { terminalId?: string }): Promise<BuildResult>;

  /**
   * Send the restart signal to the server.
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
   * @param opts.target  'backend' | 'sdk' | 'typecheck'
   * @param opts.args    Extra CLI arguments (filters, --coverage, …). Ignored for typecheck.
   */
  runTests(opts: {
    target: "backend" | "sdk" | "typecheck";
    args?: string[];
    terminalId?: string;
  }): Promise<TestResult>;
}
