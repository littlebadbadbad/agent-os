/**
 * internal-plugins/terminal/agent/upgrade/pluginAdapter.ts — Upgrade PluginAdapter
 *
 * Implements UpgradePluginAdapter using a pre-bound PluginApiClient.
 * ALL communication — RPC calls — goes through host.apiClient.
 *
 * Terminal operations are NOT part of this adapter — upgrade tools use
 * the co-located terminal APIs directly.
 */

import type { PluginApiClient } from "@agent-type";
import type {
  UpgradePluginAdapter,
  VersionInfo,
  BuildResult,
  DevServerStatus,
  DevStartResult,
  TestResult,
} from "./types";

// ── Factory ────────────────────────────────────────────────────────────────

export function createUpgradePluginAdapter(
  apiClient: PluginApiClient,
): UpgradePluginAdapter {
  return {
    async getVersion(): Promise<VersionInfo> {
      return apiClient.call<VersionInfo>("upgrade.version");
    },

    async build(opts?: { terminalId?: string }): Promise<BuildResult> {
      const params: Record<string, unknown> = {};
      if (opts?.terminalId) params.terminalId = opts.terminalId;
      return apiClient.call<BuildResult>("upgrade.build", params);
    },

    async restart(): Promise<void> {
      try {
        await apiClient.call("upgrade.restart");
      } catch {
        // Connection closed = restart triggered — this is expected.
      }
    },

    async devStart(signal?: AbortSignal): Promise<DevStartResult> {
      return apiClient.call<DevStartResult>("upgrade.devStart", {});
    },

    async devStop(): Promise<void> {
      await apiClient.call("upgrade.devStop").catch(() => {
        /* best-effort */
      });
    },

    async devStatus(): Promise<DevServerStatus> {
      return apiClient.call<DevServerStatus>("upgrade.devStatus");
    },

    async runTests(opts: {
      target: "backend" | "sdk" | "typecheck";
      args?: string[];
      terminalId?: string;
    }): Promise<TestResult> {
      const params: Record<string, unknown> = { target: opts.target };
      if (opts.args?.length) params.args = opts.args;
      if (opts.terminalId) params.terminalId = opts.terminalId;
      return apiClient.call<TestResult>("upgrade.runTests", params);
    },
  };
}
