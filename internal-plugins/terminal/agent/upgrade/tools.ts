/**
 * internal-plugins/terminal/agent/upgrade/tools.ts — Upgrade tool definitions
 *
 * Defines 7 tools: upgrade_get_version, upgrade_build, upgrade_restart,
 * upgrade_dev_start, upgrade_dev_stop, upgrade_run_tests, upgrade_complete.
 *
 * All confirm flows use `context.requestUserInput` exclusively.
 * Terminal polling uses the co-located terminal plugin adapter.
 */

import { z } from "zod";
import { defineTool } from "@agent-type/defineTool";
import { ctxKey } from "@agent-type";
import type { ToolSetContext, UserInputRequest } from "@agent-type";
import type { UpgradePluginAdapter } from "./types";
import { upgradeStore } from "./store";
import { truncateHeadTail } from "./truncateOutput";

// ── Minimal terminal contract ─────────────────────────────────────────────

/**
 * Subset of TerminalManagerAdapter needed by upgrade tools.
 * The upgrade workflow uses waitTerminal (server-side idle/exit detection)
 * instead of client-side polling, and sendInput for Ctrl+C on timeout.
 */
interface MinimalTerminalAdapter {
  readOutput(
    id: string,
    offset: number,
  ): Promise<{ output: string; offset: number; running: boolean; exitCode?: number }>;
  sendInput(id: string, text: string): Promise<void>;
  waitTerminal(
    id: string,
    opts: { idleMs?: number; timeoutMs?: number },
  ): Promise<{
    output: string;
    offset: number;
    running: boolean;
    exitCode?: number;
    timedOut: boolean;
    reason: 'idle' | 'exited' | 'timeout' | 'cancelled';
  }>;
  cancelWait(id: string): Promise<void>;
}

// ── waitForTerminal context ────────────────────────────────────────────────

type WaitContext = ToolSetContext & {
  signal?: AbortSignal;
  requestUserInput?: (request: UserInputRequest, id?: string) => Promise<string | null>;
  cancelUserInput?: (id: string) => void;
};

type WaitMode = "silent" | "interactive";

// ── Shared wait-for-terminal helper ────────────────────────────────────────

/**
 * Wait for a terminal to become idle or exit using the server-side
 * waitTerminal RPC — no client-side polling.
 *
 * In interactive mode, a cancel button is shown. Clicking it calls
 * cancelWait() on the backend, which resolves the in-flight waitTerminal
 * promise with reason 'cancelled'.
 */
async function waitForTerminal(
  terminalId: string,
  context: WaitContext,
  terminal: MinimalTerminalAdapter,
  opts: {
    mode?: WaitMode;
    idleMs?: number;
    timeoutMs?: number;
    label?: string;
  } = {},
): Promise<{
  reason: "exited" | "idle" | "cancelled" | "aborted" | "timeout";
  exitCode: number | undefined;
  output: string;
  running: boolean;
  timedOut: boolean;
}> {
  const {
    mode = "interactive",
    idleMs = 2000,
    timeoutMs = 300_000,
    label = "命令",
  } = opts;

  const cancelInputId = crypto.randomUUID();

  // Interactive mode: show cancel button that calls cancelWait on the backend
  let userCancelled = false;
  const userInputPromise =
    mode === "interactive" && context.requestUserInput
      ? context
          .requestUserInput(
            {
              ephemeral: true,
              type: "confirm",
              message: `等待 ${label} 执行完毕（终端: ${terminalId}）。点击确定停止等待（命令继续在后台运行）`,
            },
            cancelInputId,
          )
          .then((v) => {
            if (v !== null) {
              userCancelled = true;
              terminal.cancelWait(terminalId).catch(() => {});
            }
          })
      : Promise.resolve(null);

  // If an abort signal is provided, also cancel the wait
  const abortListener = () => {
    terminal.cancelWait(terminalId).catch(() => {});
  };
  context.signal?.addEventListener("abort", abortListener);

  try {
    const result = await terminal.waitTerminal(terminalId, {
      idleMs,
      timeoutMs,
    });

    return {
      reason: userCancelled || context.signal?.aborted ? "cancelled" : result.reason,
      exitCode: result.exitCode,
      output: result.output,
      running: result.running,
      timedOut: result.timedOut,
    };
  } catch {
    // If the backend wait was cancelled or errored, return current output
    const snap = await terminal
      .readOutput(terminalId, 0)
      .catch(() => ({ output: "", offset: 0, running: true }));
    return {
      reason: userCancelled ? "cancelled" : context.signal?.aborted ? "aborted" : "idle",
      exitCode: snap.exitCode,
      output: snap.output,
      running: snap.running,
      timedOut: false,
    };
  } finally {
    context.signal?.removeEventListener("abort", abortListener);
    context.cancelUserInput?.(cancelInputId);
    void userInputPromise;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export interface CreateUpgradeToolsOptions {
  readonly adapter: UpgradePluginAdapter;
  readonly terminal: MinimalTerminalAdapter;
}

export function createUpgradeTools(opts: CreateUpgradeToolsOptions) {
  const { adapter, terminal } = opts;

  // ── upgrade_get_version ──────────────────────────────────────────────

  const upgradeGetVersion = defineTool({
    name: "upgrade_get_version",
    group: "Upgrade",
    description: "Return the version string of the currently running server.",
    parameters: z.object({}),
    execute: async (_args, context) => {
      const info = await adapter.getVersion();
      upgradeStore.setVersion(ctxKey(context), info);
      return info;
    },
  });

  // ── upgrade_build ─────────────────────────────────────────────────────

  const upgradeBuild = defineTool({
    name: "upgrade_build",
    group: "Upgrade",
    description:
      "Compile and package a new server version by running `pnpm build:exe` from the " +
      "project source root. " +
      "Use `mode` to control whether a cancel button is shown:\n" +
      '- `"interactive"` (default) — shows a cancel button you can click to return early\n' +
      '- `"silent"` — no UI, just waits; returns when the build finishes\n\n' +
      "Returns success flag, the new version name, and the terminal ID on completion.\n" +
      "Pass an existing `terminalId` to reuse that terminal, or omit to get a new one.",
    parameters: z.object({
      terminalId: z
        .string()
        .optional()
        .describe(
          "Run the build inside this existing terminal. A new terminal is created when omitted.",
        ),
      mode: z
        .enum(["silent", "interactive"])
        .optional()
        .describe(
          '"interactive" (default) shows a cancel button; "silent" waits without UI.',
        ),
    }),
    execute: async (
      { terminalId: inputTerminalId, mode = "interactive" },
      context,
    ) => {
      const { terminalId } = await adapter.build({
        terminalId: inputTerminalId,
      });

      const result = await waitForTerminal(terminalId, context, terminal, {
        mode: mode as WaitMode,
        label: "pnpm build:exe",
        timeoutMs: 300_000,
      });

      const fullSnap = await terminal
        .readOutput(terminalId, 0)
        .catch(() => ({
          output: "",
          offset: 0,
          running: false,
          exitCode: -1,
        }));
      const success =
        result.reason === "exited" &&
        (result.exitCode ?? fullSnap.exitCode) === 0;

      let version: string | undefined;
      if (success) {
        try {
          const info = await adapter.getVersion();
          version = info.version;
        } catch {
          /* non-fatal */
        }
      }

      const isFileNotFound = /File not found/i.test(fullSnap.output);
      const hint = success
        ? "Build completed successfully."
        : isFileNotFound
          ? "终端启动失败（File not found），请直接在已有终端中运行 pnpm build:exe"
          : `Build failed (exit ${result.exitCode}). Use terminal log to debug.`;

      return {
        reason: result.reason,
        success,
        exitCode: result.exitCode,
        output: truncateHeadTail(fullSnap.output),
        hint,
        version,
        terminalId,
        running: result.running,
      };
    },
  });

  // ── upgrade_restart ────────────────────────────────────────────────────

  const upgradeRestart = defineTool({
    name: "upgrade_restart",
    group: "Upgrade",
    description:
      "Restart the server so the launcher picks up a newly built version.\n\n" +
      "Issues two confirmations before restarting:\n" +
      "1. **Pre-restart** (ephemeral): user confirms the page will reload.\n" +
      "2. **Post-restart** (persisted): a 'continue session?' prompt that survives " +
      "the restart. When `UserInputToolSet` is installed, ghost-restore sends the " +
      "user's reply back into the conversation automatically.",
    parameters: z.object({
      message: z
        .string()
        .optional()
        .describe(
          "Optional context prepended to the confirmation prompt.",
        ),
    }),
    execute: async ({ message }, context) => {
      const preMsg =
        (message ? `${message}\n\n` : "") +
        "The server will restart and the page will reload. Proceed?";

      // Confirm via requestUserInput — prefer this over any fallback.
      const result = context.requestUserInput
        ? await context.requestUserInput({
            type: "confirm",
            message: preMsg,
            ephemeral: true,
          })
        : null;

      if (result !== "yes") return { status: "cancelled" as const };

      // Post-restart "continue session?" prompt — persisted via ghost-restore.
      const continueMsg =
        "The server was restarted for an upgrade. " +
        'Your session was interrupted — reply "yes" to continue from where you left off.';

      if (context.requestUserInput) {
        void context.requestUserInput({
          type: "confirm",
          message: continueMsg,
        });
      }

      // Flush persistence before restart so the post-restart prompt is saved.
      if (context.flushPersistence) {
        try {
          await context.flushPersistence();
        } catch {
          /* non-fatal */
        }
      }

      await adapter.restart();
      return { status: "triggered" as const };
    },
  });

  // ── upgrade_dev_start ──────────────────────────────────────────────────

  const upgradeDevStart = defineTool({
    name: "upgrade_dev_start",
    group: "Upgrade",
    description:
      "Start the frontend dev server (`pnpm demo`). " +
      "Returns the local dev URL and the terminal ID once Vite is ready. " +
      "Use `mode` to control whether a cancel button is shown while waiting.",
    parameters: z.object({
      mode: z
        .enum(["silent", "interactive"])
        .optional()
        .describe(
          '"interactive" (default) shows a cancel button; "silent" waits without UI.',
        ),
    }),
    execute: async ({ mode = "interactive" }, context) => {
      const cancelInputId = crypto.randomUUID();
      const cancel = { triggered: false };

      if (mode === "interactive" && context.requestUserInput) {
        context
          .requestUserInput(
            {
              ephemeral: true,
              type: "confirm",
              message: "等待 dev server 启动，点击确定取消等待",
            },
            cancelInputId,
          )
          .then((v) => {
            if (v !== null) cancel.triggered = true;
          });
      }

      const ac = new AbortController();
      const cancelCheck = setInterval(() => {
        if (cancel.triggered) ac.abort();
      }, 200);

      try {
        const result = await adapter.devStart(ac.signal);
        clearInterval(cancelCheck);
        context.cancelUserInput?.(cancelInputId);
        upgradeStore.setDevState(
          ctxKey(context),
          result.url,
          true,
          result.terminalId,
        );
        return {
          ...result,
          hint: `Dev server terminal opened (id: ${result.terminalId}).`,
        };
      } catch (err: unknown) {
        clearInterval(cancelCheck);
        context.cancelUserInput?.(cancelInputId);
        if (
          cancel.triggered ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return {
            started: false,
            reason: "cancelled",
            hint: "Dev server start cancelled.",
          };
        }
        throw err;
      }
    },
  });

  // ── upgrade_dev_stop ────────────────────────────────────────────────────

  const upgradeDevStop = defineTool({
    name: "upgrade_dev_stop",
    group: "Upgrade",
    description: "Stop the frontend dev server if it is running.",
    parameters: z.object({}),
    execute: async (_args, context) => {
      await adapter.devStop();
      upgradeStore.setDevState(ctxKey(context), undefined, false);
      return { stopped: true };
    },
  });

  // ── upgrade_run_tests ───────────────────────────────────────────────────

  const upgradeRunTests = defineTool({
    name: "upgrade_run_tests",
    group: "Upgrade",
    description:
      "Run the test suite via vitest or run tsc type-checking.\n\n" +
      '- `target="backend"`    → uses `vitest.config.ts` (backend/__tests__/)\n' +
      '- `target="sdk"`        → uses `vitest.sdk.config.ts` (src/__tests__/)\n' +
      '- `target="typecheck"`  → runs `tsc --noEmit` (all src/ + demo/ .ts files)\n\n' +
      "The `args` array is forwarded verbatim to the vitest CLI. " +
      "Use `mode` to control waiting behaviour:\n" +
      '- `"interactive"` (default) — shows a cancel button\n' +
      '- `"silent"` — no UI, just waits for test completion\n\n' +
      "Pass an existing `terminalId` to reuse that terminal, or omit to get a new one.",
    parameters: z.object({
      target: z
        .enum(["backend", "sdk", "typecheck"])
        .describe(
          "Which target to run: backend tests, SDK tests, or tsc type-checking.",
        ),
      args: z
        .array(z.string())
        .optional()
        .describe(
          'Extra CLI arguments passed directly to vitest (e.g. ["--coverage", "chat"]).',
        ),
      terminalId: z
        .string()
        .optional()
        .describe(
          "Run tests inside this existing terminal. A new terminal is created when omitted.",
        ),
      mode: z
        .enum(["silent", "interactive"])
        .optional()
        .describe(
          '"interactive" (default) shows a cancel button; "silent" waits without UI.',
        ),
    }),
    execute: async (
      { target, args, terminalId, mode = "interactive" },
      context,
    ) => {
      const { terminalId: tid } = await adapter.runTests({
        target,
        args,
        terminalId,
      });

      const result = await waitForTerminal(tid, context, terminal, {
        mode: mode as WaitMode,
        label: "vitest",
        timeoutMs: 300_000,
      });

      const fullSnap = await terminal
        .readOutput(tid, 0)
        .catch(() => ({
          output: "",
          offset: 0,
          running: false,
          exitCode: 1,
        }));
      const success =
        result.reason === "exited" &&
        (result.exitCode ?? fullSnap.exitCode) === 0;

      return {
        reason: result.reason,
        success,
        output: truncateHeadTail(fullSnap.output),
        terminalId: tid,
        running: result.running,
        hint: success
          ? "Tests completed successfully."
          : `Tests failed (exit ${result.exitCode}). Use terminal tools to review output.`,
      };
    },
  });

  // ── upgrade_complete ────────────────────────────────────────────────────

  const upgradeComplete = defineTool({
    name: "upgrade_complete",
    group: "Upgrade",
    description:
      "Seal the current upgrade cycle. Call this after the new version is confirmed live.\n\n" +
      "Effects:\n" +
      "- Blocks file-edit, git, and other upgrade tools for the rest of this turn\n" +
      "- Instructs you to write a delivery summary for the user and end the turn\n" +
      "- Restrictions lift automatically when the user sends their next message",
    parameters: z.object({}),
    execute: async (_args, context) => {
      upgradeStore.setFrozen(ctxKey(context), true);
      return "Upgrade cycle sealed. Write a concise delivery summary for the user and end this turn.";
    },
  });

  return [
    upgradeGetVersion,
    upgradeBuild,
    upgradeRestart,
    upgradeDevStart,
    upgradeDevStop,
    upgradeRunTests,
    upgradeComplete,
  ] as const;
}
