import type { UpgradeAdapter, VersionInfo, BuildResult, TerminalSnapshot, DevServerStatus, DevStartResult, TestResult } from './adapter';
import type { UpgradeConfirmFn } from './confirm';
import { autoConfirm } from './confirm';

// ── Config ────────────────────────────────────────────────────────────────────

export type HttpUpgradeAdapterConfig = {
  /**
   * Base URL prefix for the agent-sdk backend API.
   * Defaults to `'/api'`.
   */
  baseUrl?: string;
  /**
   * Confirm function used in lifecycle hooks where `context.requestUserInput`
   * is not available (e.g. pre-restart in headless mode, `onSessionReady`
   * fallback after restart).
   *
   * Defaults to `autoConfirm()` — `window.confirm` in browsers, readline in Node.
   */
  confirm?: UpgradeConfirmFn;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an `UpgradeAdapter` backed by the agent-sdk backend REST API.
 */
export function createHttpUpgradeAdapter(
  config: HttpUpgradeAdapterConfig = {},
): UpgradeAdapter {
  const base = (config.baseUrl ?? '/api').replace(/\/$/, '');

  const confirmFn: UpgradeConfirmFn = config.confirm ?? autoConfirm();

  return {
    async getVersion(): Promise<VersionInfo> {
      const res = await fetch(`${base}/upgrade/version`);
      if (!res.ok) throw new Error(`GET /api/upgrade/version — HTTP ${res.status}`);
      return res.json() as Promise<VersionInfo>;
    },

    async build(opts?: { terminalId?: string }): Promise<BuildResult> {
      const body: Record<string, unknown> = {};
      if (opts?.terminalId != null) body.terminalId = opts.terminalId;
      const res = await fetch(`${base}/upgrade/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Short timeout — the endpoint returns immediately after starting the build.
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`POST /api/upgrade/build — HTTP ${res.status}`);
      return res.json() as Promise<BuildResult>;
    },

    async readTerminalOutput(terminalId: string, offset: number): Promise<TerminalSnapshot> {
      const res = await fetch(
        `${base}/terminals/${encodeURIComponent(terminalId)}/output?offset=${offset}`,
      );
      if (!res.ok) throw new Error(`GET /api/terminals/output — HTTP ${res.status}`);
      return res.json() as Promise<TerminalSnapshot>;
    },

    async sendTerminalInput(terminalId: string, text: string): Promise<void> {
      // Best-effort — a dead terminal should not abort the caller.
      await fetch(`${base}/terminals/${encodeURIComponent(terminalId)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(() => { /* ignore — terminal may have already exited */ });
    },

    async restart(): Promise<void> {
      let res: Response;
      try {
        res = await fetch(`${base}/upgrade/restart`, { method: 'POST' });
      } catch {
        // Network error: the server closed the connection — restart was triggered.
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `POST /api/upgrade/restart — HTTP ${res.status}`);
      }
    },

    async devStart(signal?: AbortSignal): Promise<DevStartResult> {
      const res = await fetch(`${base}/upgrade/dev/start`, { method: 'POST', signal });
      if (!res.ok) throw new Error(`POST /api/upgrade/dev/start — HTTP ${res.status}`);
      return res.json() as Promise<DevStartResult>;
    },

    async devStop(): Promise<void> {
      await fetch(`${base}/upgrade/dev/stop`, { method: 'POST' }).catch(() => { /* best-effort */ });
    },

    async devStatus(): Promise<DevServerStatus> {
      const res = await fetch(`${base}/upgrade/dev/status`);
      if (!res.ok) throw new Error(`GET /api/upgrade/dev/status — HTTP ${res.status}`);
      return res.json() as Promise<DevServerStatus>;
    },

    async runTests(opts): Promise<TestResult> {
      const res = await fetch(`${base}/upgrade/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
        // Short timeout — the endpoint returns immediately after starting the tests.
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`POST /api/upgrade/test — HTTP ${res.status}`);
      return res.json() as Promise<TestResult>;
    },

    confirm: confirmFn,
  };
}
