/**
 * src/tools/upgrade/ipcAdapter.ts — Electron IPC adapter for upgrade operations
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 * Terminal operations reuse the terminal IPC channels.
 */

import type { UpgradeAdapter, VersionInfo, BuildResult, TerminalSnapshot, DevServerStatus, DevStartResult, TestResult } from './adapter';
import type { UpgradeConfirmFn } from './confirm';
import { autoConfirm } from './confirm';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcUpgradeAdapterConfig = {
  /**
   * Confirm function used in lifecycle hooks where `context.requestUserInput`
   * is not available.
   */
  confirm?: UpgradeConfirmFn;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an `UpgradeAdapter` backed by Electron IPC instead of HTTP REST.
 *
 * @example
 * ```ts
 * const adapter = createIpcUpgradeAdapter();
 * ```
 */
export function createIpcUpgradeAdapter(
  config: IpcUpgradeAdapterConfig = {},
): UpgradeAdapter {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcUpgradeAdapter: window.electronAPI.invoke is not available');
  }

  const confirmFn: UpgradeConfirmFn = config.confirm ?? autoConfirm();

  return {
    async getVersion(): Promise<VersionInfo> {
      return invoke('upgrade:version') as Promise<VersionInfo>;
    },

    async build(opts?: { terminalId?: string }): Promise<BuildResult> {
      // In IPC mode, shell commands are run in the main process via terminal IPC
      const body: Record<string, unknown> = {};
      if (opts?.terminalId != null) body.terminalId = opts.terminalId;
      return invoke('upgrade:build', body) as Promise<BuildResult>;
    },

    async readTerminalOutput(terminalId: string, offset: number): Promise<TerminalSnapshot> {
      return invoke('terminals:readOutput', { id: terminalId, fromOffset: offset }) as Promise<TerminalSnapshot>;
    },

    async sendTerminalInput(terminalId: string, text: string): Promise<void> {
      await invoke('terminals:sendInput', { id: terminalId, text }).catch(() => {});
    },

    async restart(): Promise<void> {
      try {
        await invoke('upgrade:restart');
      } catch {
        // Network error / connection closed = restart was triggered.
      }
    },

    async devStart(signal?: AbortSignal): Promise<DevStartResult> {
      return invoke('upgrade:devStart', {}) as Promise<DevStartResult>;
    },

    async devStop(): Promise<void> {
      await invoke('upgrade:devStop', {}).catch(() => {});
    },

    async devStatus(): Promise<DevServerStatus> {
      return invoke('upgrade:devStatus') as Promise<DevServerStatus>;
    },

    async runTests(opts): Promise<TestResult> {
      return invoke('upgrade:runTests', opts) as Promise<TestResult>;
    },

    confirm: confirmFn,
  };
}
