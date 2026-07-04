import type { SectionId } from '@agent-type';

// ── Section ID ────────────────────────────────────────────────────────────────

/**
 * Unique section identifier for the Upgrade ToolSet system-prompt section.
 *
 * Registered in the canonical `SECTION_IDS` array.  Only one ToolSet per
 * section id survives deduplication, so agents that declare their own
 * upgrade section must use a different id or accept being overridden.
 */
export const UPGRADE_SECTION_ID: SectionId = 'upgrade';

// ── Tool descriptions (rich) ──────────────────────────────────────────────────
//
// Each description follows the same three-part structure:
//   Summary     — one-line what the tool does
//   When to use — concrete scenarios that call for this tool
//   Behavior    — side effects, modes, error recovery, output shape
//
// These are designed to be embedded in system-prompt sections so the LLM
// can self-select the right tool without re-reading the full parameter schema.

// ── upgrade_get_version ──────────────────────────────────────────────────────

/**
 * **upgrade_get_version** — Return the version string of the currently running server.
 *
 * **When to use:**
 * - At the start of a session to confirm what version is deployed.
 * - After a build/restart cycle to verify the new version is live.
 * - Before submitting a bug report or delivery summary.
 *
 * **Behavior:**
 * - Queries the running server's `/version` endpoint (or equivalent).
 * - Returns an object with `{ version, commit, buildTime }` fields.
 * - Stores the result in the in-memory upgrade store for later reference.
 * - No side effects — safe to call at any time.
 */
export const GET_VERSION_DESCRIPTION =
  'Return the version string of the currently running server.\n\n' +
  '**Summary** — Queries the live server for its version, commit hash, and build time.\n\n' +
  '**When to use**:\n' +
  '- Start-of-session check to confirm the deployed version\n' +
  '- After building and restarting to verify the new binary is live\n' +
  '- Before a delivery summary to document the final version\n\n' +
  '**Behavior**: Safe, read-only, no side effects.  Result is cached in the upgrade store.';

// ── upgrade_build ────────────────────────────────────────────────────────────

/**
 * **upgrade_build** — Compile and package a new server version.
 *
 * **When to use:**
 * - After making changes to source code that need to be compiled.
 * - When the agent explicitly requests a build to pick up changes.
 * - Before `upgrade_restart` — a build must succeed before restarting.
 *
 * **Behavior:**
 * - Runs `pnpm build:exe` from the project root in a terminal.
 * - Supports two modes: `"interactive"` (shows a cancel button) and
 *   `"silent"` (no UI, blocks until the build finishes or times out).
 * - You can pass an existing `terminalId` to re-use a terminal, or omit
 *   to get a fresh one.
 * - Timeout is 5 minutes — builds taking longer are cancelled with Ctrl+C.
 * - On success, returns the new `version` string, the terminal id, and
 *   a success hint.  On failure, returns the truncated terminal output
 *   and an error hint suggesting next steps.
 * - File-not-found errors produce a hint suggesting manual fallback.
 */
export const BUILD_DESCRIPTION =
  'Compile and package a new server version by running `pnpm build:exe`.\n\n' +
  '**Summary** — Builds the production binary so the launcher can pick it up.\n\n' +
  '**When to use**:\n' +
  '- After editing source files (backend or shared code)\n' +
  '- When the agent asks to build before restarting\n' +
  '- To produce a new version for deployment\n\n' +
  '**Behavior**:\n' +
  '- Runs `pnpm build:exe` in the project root terminal\n' +
  '- `mode="interactive"` (default) — shows a cancel button in the chat UI\n' +
  '- `mode="silent"` — no UI, waits for the build to finish\n' +
  '- Pass `terminalId` to re-use an existing terminal, or omit for a new one\n' +
  '- Timeout: 300 seconds — sends Ctrl+C and returns partial output\n' +
  '- Returns `{ reason, success, exitCode, output, hint, version, terminalId }`\n' +
  '- On file-not-found errors, hints at running `pnpm build:exe` manually';

// ── upgrade_restart ─────────────────────────────────────────────────────────

/**
 * **upgrade_restart** — Restart the server to pick up a newly built version.
 *
 * **When to use:**
 * - After a successful build to deploy the new binary.
 * - When the server becomes unresponsive and a clean restart is needed.
 *
 * **Behavior:**
 * - Issues two confirmation prompts before actually restarting:
 *   1. **Pre-restart** (ephemeral, in-line) — warns that the page will reload.
 *      If the user declines, returns `{ status: 'cancelled' }`.
 *   2. **Post-restart** (persisted, survives reload) — asks the user to confirm
 *      the session should continue.  When `UserInputToolSet` is installed, the
 *      agent's ghost-restore mechanism feeds the response back into the conversation.
 * - Flushes persistence before restarting (if `flushPersistence` is available).
 * - Returns immediately after triggering the restart — does not wait for the
 *   server to come back up.
 * - On fallback agents without `requestUserInput`, sets an internal
 *   `restartPending` flag that downstream middleware can check.
 */
export const RESTART_DESCRIPTION =
  'Restart the server so the launcher picks up the newly built version.\n\n' +
  '**Summary** — Triggers a server restart with two-stage user confirmation.\n\n' +
  '**When to use**:\n' +
  '- Immediately after `upgrade_build` succeeds\n' +
  '- When you need the running server to reflect the latest compiled binary\n\n' +
  '**Behavior**:\n' +
  '- **Phase 1** — ephemeral in-chat confirmation: "The server will restart and the page will reload. Proceed?"\n' +
  '  - User declines → returns `{ status: "cancelled" }`\n' +
  '  - User confirms → proceeds to phase 2\n' +
  '- **Phase 2** — persisted confirmation that survives the reload: "Your session was interrupted — reply yes to continue"\n' +
  '  - When `requestUserInput` is available, sends a persisted prompt that ghost-restore picks up\n' +
  '  - Otherwise sets the `restartPending` flag in the store for middleware to handle\n' +
  '- Flushes persistence (`flushPersistence`) before issuing the restart command\n' +
  '- Returns `{ status: "triggered" }` — does **not** wait for the server to come back online';

// ── upgrade_dev_start ────────────────────────────────────────────────────────

/**
 * **upgrade_dev_start** — Start the frontend dev server.
 *
 * **When to use:**
 * - When you need to visually inspect or debug the frontend.
 * - When running end-to-end tests that require a dev server.
 * - Before calling `browser_navigate` to the dev URL.
 *
 * **Behavior:**
 * - Runs the equivalent of `pnpm demo` in a new or reused terminal.
 * - Polls for the Vite / dev-server URL (250 ms interval, 30 s timeout).
 * - Supports `mode="interactive"` (cancel button) and `mode="silent"`.
 * - Returns the local dev URL (e.g. `http://localhost:5173`) once ready.
 * - Stores the dev URL and terminal id in the upgrade store so other tools
 *   can reference them without re-querying.
 * - If cancelled, returns `{ started: false, reason: 'cancelled' }`.
 */
export const DEV_START_DESCRIPTION =
  'Start the frontend dev server (`pnpm demo`).\n\n' +
  '**Summary** — Launches a Vite-based dev server and waits for it to be ready.\n\n' +
  '**When to use**:\n' +
  '- Before visual inspection or debugging of the frontend UI\n' +
  '- Before `browser_navigate` to the local dev URL\n' +
  '- When running tests that need a live dev server\n\n' +
  '**Behavior**:\n' +
  '- Runs `pnpm demo` in a terminal\n' +
  '- Polls for the Vite URL (250 ms interval, 30 s timeout)\n' +
  '- `mode="interactive"` (default) — shows a cancel button\n' +
  '- `mode="silent"` — no UI, blocks until the URL is detected or the timeout expires\n' +
  '- Returns `{ url, terminalId, started, hint }`\n' +
  '- Stores the dev state in the upgrade store for later reference by other tools\n' +
  '- On cancellation returns `{ started: false, reason: "cancelled" }`';

// ── upgrade_dev_stop ─────────────────────────────────────────────────────────

/**
 * **upgrade_dev_stop** — Stop the frontend dev server if it is running.
 *
 * **When to use:**
 * - After frontend visual verification is complete.
 * - To free terminal resources that the dev server is consuming.
 * - Before a build to avoid port conflicts or stale file watchers.
 *
 * **Behavior:**
 * - Sends a stop signal to the running dev server process.
 * - Clears the dev URL and running state from the upgrade store.
 * - Idempotent — safe to call even if no dev server is running.
 * - Returns `{ stopped: true }`.
 */
export const DEV_STOP_DESCRIPTION =
  'Stop the frontend dev server if it is running.\n\n' +
  '**Summary** — Gracefully shuts down the Vite dev server and cleans up state.\n\n' +
  '**When to use**:\n' +
  '- After finishing frontend visual inspection\n' +
  '- To free the terminal for other tasks (e.g. a new build)\n' +
  '- Before building or restarting to avoid port / file-watcher conflicts\n\n' +
  '**Behavior**:\n' +
  '- Sends a stop signal to the dev server process\n' +
  '- Clears `devUrl`, `devTerminalId`, and `devRunning` from the in-memory store\n' +
  '- Idempotent — safe to call even when no dev server is running\n' +
  '- Returns `{ stopped: true }`';

// ── upgrade_run_tests ────────────────────────────────────────────────────────

/**
 * **upgrade_run_tests** — Run the test suite with different targets.
 *
 * **When to use:**
 * - Before committing to verify changes don't break existing tests.
 * - After editing backend code → `target="backend"`.
 * - After editing SDK code → `target="sdk"`.
 * - After any TypeScript change → `target="typecheck"` (tsc --noEmit).
 * - To run a specific test by name, pass `args: ["--coverage", "testName"]`.
 *
 * **Behavior:**
 * - Accepts three targets:
 *   - `"backend"`    → `vitest --config vitest.config.ts` (backend/__tests__/)
 *   - `"sdk"`        → `vitest --config vitest.sdk.config.ts` (src/__tests__/)
 *   - `"typecheck"`  → `tsc --noEmit` (all .ts files in src/ and demo/)
 * - Extra `args` are forwarded verbatim to the vitest CLI (not used for typecheck).
 * - Supports `mode="interactive"` (cancel button) and `mode="silent"`.
 * - Supports reusing an existing terminal via `terminalId`.
 * - Timeout is 5 minutes — long-running tests are aborted with Ctrl+C.
 * - Returns `{ reason, success, output, terminalId, running, hint }`.
 * - On failure, the truncated terminal output helps diagnose the issue.
 */
export const RUN_TESTS_DESCRIPTION =
  'Run the test suite via vitest or run tsc type-checking.\n\n' +
  '**Summary** — Executes backend tests, SDK tests, or TypeScript type-checking.\n\n' +
  '**When to use**:\n' +
  '- After editing backend code → `target="backend"`\n' +
  '- After editing SDK/public API code → `target="sdk"`\n' +
  '- After any TypeScript change → **run `target="typecheck"` first** (fix all type errors before unit tests)\n' +
  '- To run a single test → pass its name in `args`, e.g. `args: ["chat"]`\n' +
  '- Before committing or delivering changes\n\n' +
  '**Behavior**:\n' +
  '- `target="backend"` — runs vitest with `vitest.config.ts` (backend test files)\n' +
  '- `target="sdk"` — runs vitest with `vitest.sdk.config.ts` (SDK test files)\n' +
  '- `target="typecheck"` — runs `tsc --noEmit` to check all TypeScript files\n' +
  '- `args` array is forwarded verbatim to vitest (ignored for typecheck)\n' +
  '- `mode="interactive"` (default) — shows a cancel button\n' +
  '- `mode="silent"` — no UI, blocks until tests finish or timeout\n' +
  '- Pass `terminalId` to reuse an existing terminal\n' +
  '- Timeout: 300 seconds — sends Ctrl+C and returns partial output\n' +
  '- Returns `{ reason, success, output, terminalId, running, hint }`\n' +
  '- On failure, truncated terminal output is provided for debugging';

// ── upgrade_complete ─────────────────────────────────────────────────────────

/**
 * **upgrade_complete** — Seal the current upgrade cycle.
 *
 * **When to use:**
 * - After the new version is confirmed live (build → restart → verify).
 * - Must be called once at the end of every upgrade turn.
 *
 * **Behavior:**
 * - Freezes the upgrade store, blocking file-editing, git, and other
 *   upgrade-related tools for the remainder of the current turn.
 * - Instructs the agent to write a concise delivery summary for the user.
 * - Restrictions are lifted automatically when the user sends the next message.
 * - Calling this is mandatory — without it, the upgrade cycle is not considered
 *   complete and the agent may continue making changes.
 */
export const COMPLETE_DESCRIPTION =
  'Seal the current upgrade cycle. Call this after the new version is confirmed live.\n\n' +
  '**Summary** — Finalises the build → restart → verify loop and freezes upgrade tools.\n\n' +
  '**When to use**:\n' +
  '- Only after `upgrade_build` → `upgrade_restart` → **visual verification** is complete\n' +
  '- At the very end of every upgrade turn — no exceptions\n\n' +
  '**Behavior**:\n' +
  '- Freezes the upgrade store (`setFrozen(true)`)\n' +
  '- Blocks file-edit, git, and other upgrade-related tools for the rest of this turn\n' +
  '- Returns an instruction to write a delivery summary and end the turn\n' +
  '- Restrictions automatically lift when the user sends their next message\n' +
  '- **Mandatory** — the upgrade cycle is not considered complete without calling this tool';
