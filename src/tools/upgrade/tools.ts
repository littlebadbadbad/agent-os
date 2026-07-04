import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { toolSetContextKey } from '../toolSet';
import type { ToolSetContext } from '@agent-type';
import type { UserInputRequest } from '../types';
import type { UpgradeAdapter, TerminalSnapshot } from './adapter';
import { upgradeStore } from './store';
import { truncateHeadTail } from './truncateOutput';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Context needed by waitForTerminal — a subset of ToolExecutionContext fields
 * that ToolSetContext doesn't carry.  The tool execute() functions pass their
 * full ToolExecutionContext, which satisfies this union.
 */
type WaitForTerminalContext = ToolSetContext & {
  signal?: AbortSignal;
  requestUserInput?: (request: UserInputRequest, id?: string) => Promise<string | null>;
  cancelUserInput?: (id: string) => void;
};

function ctxKey(ctx: ToolSetContext): string {
  return toolSetContextKey(ctx);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Shared wait-for-terminal helper ───────────────────────────────────────────
//
// 参考 terminal_wait 的最佳实践：自适应轮询、idle 检测、
// 支持静默/交互两种模式、退出时保证 cancelUserInput。

type WaitMode = 'silent' | 'interactive';

async function waitForTerminal(
  terminalId: string,
  context: WaitForTerminalContext,
  adapter: UpgradeAdapter,
  {
    mode = 'interactive',
    idleMs = 2000,
    timeoutMs = 300_000,
    label = '命令',
  }: {
    mode?: WaitMode;
    idleMs?: number;
    timeoutMs?: number;
    label?: string;
  } = {},
): Promise<{
  reason: 'exited' | 'idle' | 'cancelled' | 'aborted' | 'timeout';
  exitCode: number | undefined;
  output: string;
  running: boolean;
  timedOut: boolean;
}> {
  const deadline = Date.now() + timeoutMs;
  const pollMs = Math.min(Math.floor(idleMs / 2), 250);
  let lastActivityAt = Date.now();
  let lastOffset = 0;

  const cancel = { triggered: false };
  const cancelInputId = crypto.randomUUID();

  function cleanUp() {
    context.cancelUserInput?.(cancelInputId);
  }

  // 交互模式：显示取消按钮
  if (mode === 'interactive' && context.requestUserInput) {
    context.requestUserInput(
      {
        ephemeral: true,
        type: 'confirm',
        message: `等待 ${label} 执行完毕（终端: ${terminalId}）。点击确定停止等待（命令继续在后台运行）`,
      },
      cancelInputId,
    ).then((v) => { if (v !== null) cancel.triggered = true; });
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (cancel.triggered || context.signal?.aborted) {
      cleanUp();
      const snap = await adapter.readTerminalOutput(terminalId, 0).catch(() => ({
        output: '', offset: 0, running: true,
      }));
      return {
        reason: cancel.triggered ? 'cancelled' : 'aborted',
        exitCode: undefined,
        output: snap.output,
        running: snap.running,
        timedOut: false,
      };
    }

    if (Date.now() >= deadline) {
      await adapter.sendTerminalInput(terminalId, '\x03').catch(() => {});
      await sleep(500);
      cleanUp();
      const snap = await adapter.readTerminalOutput(terminalId, 0).catch(() => ({
        output: '', offset: 0, running: false,
      }));
      return {
        reason: 'timeout',
        exitCode: undefined,
        output: snap.output,
        running: snap.running,
        timedOut: true,
      };
    }

    const snap = await adapter.readTerminalOutput(terminalId, lastOffset);

    if (snap.output.length > 0) {
      lastActivityAt = Date.now();
      lastOffset = snap.offset;
    }

    if (!snap.running) {
      cleanUp();
      const full = await adapter.readTerminalOutput(terminalId, 0);
      return {
        reason: 'exited',
        exitCode: full.exitCode,
        output: full.output,
        running: false,
        timedOut: false,
      };
    }

    if (Date.now() - lastActivityAt >= idleMs) {
      cleanUp();
      const full = await adapter.readTerminalOutput(terminalId, 0);
      return {
        reason: 'idle',
        exitCode: full.exitCode,
        output: full.output,
        running: true,
        timedOut: false,
      };
    }

    await sleep(pollMs);
  }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export function createUpgradeTools(adapter: UpgradeAdapter) {
  // ── upgrade_get_version ────────────────────────────────────────────────────

  const upgradeGetVersion = defineTool({
    name: 'upgrade_get_version',
    group: 'Upgrade',
    description: 'Return the version string of the currently running server.',
    parameters: z.object({}),
    execute: async (_args, context) => {
      const info = await adapter.getVersion();
      upgradeStore.setVersion(ctxKey(context), info);
      return info;
    },
  });

  // ── upgrade_build ─────────────────────────────────────────────────────────

  const upgradeBuild = defineTool({
    name: 'upgrade_build',
    group: 'Upgrade',
    description:
      'Compile and package a new server version by running `pnpm build:exe` from the ' +
      'project source root. ' +
      'Use `mode` to control whether a cancel button is shown:\n' +
      '- `"interactive"` (default) — shows a cancel button you can click to return early\n' +
      '- `"silent"` — no UI, just waits; returns when the build finishes\n\n' +
      'Returns success flag, the new version name, and the terminal ID on completion.\n' +
      'Pass an existing `terminalId` to reuse that terminal, or omit to get a new one.',
    parameters: z.object({
      terminalId: z.string().optional().describe('Run the build inside this existing terminal. A new terminal is created when omitted.'),
      mode: z.enum(['silent', 'interactive']).optional().describe(
        '"interactive" (default) shows a cancel button; "silent" waits without UI.',
      ),
    }),
    execute: async ({ terminalId: inputTerminalId, mode = 'interactive' }, context) => {
      const { terminalId } = await adapter.build({ terminalId: inputTerminalId });

      const result = await waitForTerminal(terminalId, context, adapter, {
        mode: mode as WaitMode,
        label: 'pnpm build:exe',
        timeoutMs: 300_000,
      });

      // 退出后读取完整输出
      const fullSnap = await adapter.readTerminalOutput(terminalId, 0).catch(() => ({
        output: '', offset: 0, running: false, exitCode: -1,
      }));
      const success = result.reason === 'exited' && (result.exitCode ?? fullSnap.exitCode) === 0;

      let version: string | undefined;
      if (success) {
        try { const info = await adapter.getVersion(); version = info.version; } catch { /* non-fatal */ }
      }

      const isFileNotFound = /File not found/i.test(fullSnap.output);
      const hint = success
        ? 'Build completed successfully.'
        : isFileNotFound
          ? '终端启动失败（File not found），请直接在已有终端中运行 pnpm build:exe'
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

  // ── upgrade_restart ────────────────────────────────────────────────────────

  const upgradeRestart = defineTool({
    name: 'upgrade_restart',
    group: 'Upgrade',
    description:
      'Restart the server so the launcher picks up a newly built version.\n\n' +
      'Issues two confirmations before restarting:\n' +
      '1. **Pre-restart** (ephemeral): user confirms the page will reload.\n' +
      '2. **Post-restart** (persisted): a "continue session?" prompt that survives ' +
      'the restart. When `UserInputToolSet` is installed, ghost-restore sends the ' +
      "user's reply back into the conversation automatically.",
    parameters: z.object({
      message: z.string().optional().describe('Optional context prepended to the confirmation prompt.'),
    }),
    execute: async ({ message }, context) => {
      const key = ctxKey(context);

      const preMsg =
        (message ? `${message}\n\n` : '') +
        'The server will restart and the page will reload. Proceed?';

      let confirmed: boolean | null;
      if (context.requestUserInput) {
        const result = await context.requestUserInput({ type: 'confirm', message: preMsg, ephemeral: true });
        confirmed = result === 'yes';
      } else {
        confirmed = await adapter.confirm(preMsg).catch(() => null);
      }
      if (!confirmed) return { status: 'cancelled' as const };

      const continueMsg =
        'The server was restarted for an upgrade. ' +
        'Your session was interrupted — reply "yes" to continue from where you left off.';

      if (context.requestUserInput) {
        void context.requestUserInput({ type: 'confirm', message: continueMsg });
      } else {
        upgradeStore.setRestartPending(key, true);
      }

      if (context.flushPersistence) {
        try { await context.flushPersistence(); } catch { /* non-fatal */ }
      }

      await adapter.restart();
      return { status: 'triggered' as const };
    },
  });

  // ── upgrade_dev_start ──────────────────────────────────────────────────────

  const upgradeDevStart = defineTool({
    name: 'upgrade_dev_start',
    group: 'Upgrade',
    description:
      'Start the frontend dev server (`pnpm demo`). ' +
      'Returns the local dev URL and the terminal ID once Vite is ready. ' +
      'Use `mode` to control whether a cancel button is shown while waiting.',
    parameters: z.object({
      mode: z.enum(['silent', 'interactive']).optional().describe(
        '"interactive" (default) shows a cancel button; "silent" waits without UI.',
      ),
    }),
    execute: async ({ mode = 'interactive' }, context) => {
      // 后端 startDevServer 内部轮询检测 Vite URL（250ms间隔，30s超时）
      // 前端在等待期间显示取消按钮
      const cancelInputId = crypto.randomUUID();
      const cancel = { triggered: false };

      if (mode === 'interactive' && context.requestUserInput) {
        context.requestUserInput(
          { ephemeral: true, type: 'confirm', message: '等待 dev server 启动，点击确定取消等待' },
          cancelInputId,
        ).then((v) => { if (v !== null) cancel.triggered = true; });
      }

      // 用 AbortController 包装 HTTP fetch，支持取消
      const ac = new AbortController();
      if (cancel.triggered) ac.abort();

      const cancelCheck = setInterval(() => {
        if (cancel.triggered) ac.abort();
      }, 200);

      try {
        const result = await adapter.devStart(ac.signal);
        clearInterval(cancelCheck);
        context.cancelUserInput?.(cancelInputId);
        upgradeStore.setDevState(ctxKey(context), result.url, true, result.terminalId);
        return { ...result, hint: `Dev server terminal opened (id: ${result.terminalId}).` };
      } catch (err: unknown) {
        clearInterval(cancelCheck);
        context.cancelUserInput?.(cancelInputId);
        if (cancel.triggered || (err instanceof DOMException && err.name === 'AbortError')) {
          return { started: false, reason: 'cancelled', hint: 'Dev server start cancelled.' };
        }
        throw err;
      }
    },
  });

  // ── upgrade_dev_stop ────────────────────────────────────────────────────��──

  const upgradeDevStop = defineTool({
    name: 'upgrade_dev_stop',
    group: 'Upgrade',
    description: 'Stop the frontend dev server if it is running.',
    parameters: z.object({}),
    execute: async (_args, context) => {
      await adapter.devStop();
      upgradeStore.setDevState(ctxKey(context), undefined, false);
      return { stopped: true };
    },
  });

  // ── upgrade_run_tests ──────────────────────────────────────────────────────

  const upgradeRunTests = defineTool({
    name: 'upgrade_run_tests',
    group: 'Upgrade',
    description:
      'Run the test suite via vitest or run tsc type-checking.\n\n' +
      '- `target="backend"`    → uses `vitest.config.ts` (backend/__tests__/)\n' +
      '- `target="sdk"`        → uses `vitest.sdk.config.ts` (src/__tests__/)\n' +
      '- `target="typecheck"`  → runs `tsc --noEmit` (all src/ + demo/ .ts files)\n\n' +
      'The `args` array is forwarded verbatim to the vitest CLI. ' +
      'Use `mode` to control waiting behaviour:\n' +
      '- `"interactive"` (default) — shows a cancel button\n' +
      '- `"silent"` — no UI, just waits for test completion\n\n' +
      'Pass an existing `terminalId` to reuse that terminal, or omit to get a new one.',
    parameters: z.object({
      target: z.enum(['backend', 'sdk', 'typecheck']).describe('Which target to run: backend tests, SDK tests, or tsc type-checking.'),
      args: z.array(z.string()).optional().describe('Extra CLI arguments passed directly to vitest (e.g. ["--coverage", "chat"]).'),
      terminalId: z.string().optional().describe('Run tests inside this existing terminal. A new terminal is created when omitted.'),
      mode: z.enum(['silent', 'interactive']).optional().describe(
        '"interactive" (default) shows a cancel button; "silent" waits without UI.',
      ),
    }),
    execute: async ({ target, args, terminalId, mode = 'interactive' }, context) => {
      const { terminalId: tid } = await adapter.runTests({ target, args, terminalId });

      const result = await waitForTerminal(tid, context, adapter, {
        mode: mode as WaitMode,
        label: 'vitest',
        timeoutMs: 300_000,
      });

      const fullSnap = await adapter.readTerminalOutput(tid, 0).catch(() => ({
        output: '', offset: 0, running: false, exitCode: 1,
      }));
      const success = result.reason === 'exited' && (result.exitCode ?? fullSnap.exitCode) === 0;

      return {
        reason: result.reason,
        success,
        output: truncateHeadTail(fullSnap.output),
        terminalId: tid,
        running: result.running,
        hint: success
          ? 'Tests completed successfully.'
          : `Tests failed (exit ${result.exitCode}). Use terminal tools to review output.`,
      };
    },
  });

  // ── upgrade_complete ───────────────────────────────────────────────────────

  const upgradeComplete = defineTool({
    name: 'upgrade_complete',
    group: 'Upgrade',
    description:
      'Seal the current upgrade cycle. Call this after the new version is confirmed live.\n\n' +
      'Effects:\n' +
      '- Blocks file-edit, git, and other upgrade tools for the rest of this turn\n' +
      '- Instructs you to write a delivery summary for the user and end the turn\n' +
      '- Restrictions lift automatically when the user sends their next message',
    parameters: z.object({}),
    execute: async (_args, context) => {
      upgradeStore.setFrozen(ctxKey(context), true);
      return 'Upgrade cycle sealed. Write a concise delivery summary for the user and end this turn.';
    },
  });

  return [upgradeGetVersion, upgradeBuild, upgradeRestart, upgradeDevStart, upgradeDevStop, upgradeRunTests, upgradeComplete] as const;
}
