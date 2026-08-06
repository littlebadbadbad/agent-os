/**
 * internal-plugins/terminal/agent/activate.ts — Terminal plugin activation entry
 *
 * Registers TWO ToolSets on the agent host:
 *   1. Terminal ToolSet — PTY shell management (7 tools)
 *   2. Upgrade ToolSet — Self-upgrade workflow (7 tools)
 *
 * Follows the same multi-toolset pattern as user-input's activate.ts.
 */

import type { AgentPluginHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createTerminalPluginAdapter, createTerminalToolSet } from './shell';
import { createUpgradePluginAdapter, createUpgradeToolSet } from './upgrade';
import { getTerminalSlotDeclarations } from './shell/toolSet';
import { getUpgradeSlotDeclarations } from './upgrade/toolSet';

/**
 * Activate the terminal plugin.
 *
 * Creates plugin adapters bound to the host's apiClient,
 * builds both ToolSets, and registers them on the agent.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  // ── Terminal ToolSet ───────────────────────────────────────────────────
  const terminalAdapter = createTerminalPluginAdapter(host.apiClient);
  const terminalToolSet = createTerminalToolSet(terminalAdapter);
  host.registerToolSet(terminalToolSet, getTerminalSlotDeclarations(resolveToolSetTools(terminalToolSet).map((t) => t.name)));

  // ── Upgrade ToolSet ────────────────────────────────────────────────────
  // Uses the same apiClient (pre-bound to 'terminal' plugin) for RPC calls,
  // plus the terminal adapter for terminal polling during build/dev/test.
  const upgradeAdapter = createUpgradePluginAdapter(host.apiClient);
  const upgradeToolSet = createUpgradeToolSet({
    adapter: upgradeAdapter,
    terminal: {
      readOutput: (id: string, offset: number) =>
        terminalAdapter.readOutput(id, offset, ""),
      sendInput: (id: string, text: string) =>
        terminalAdapter.sendInput(id, text, ""),
      waitTerminal: (id: string, opts: { idleMs?: number; timeoutMs?: number }) =>
        terminalAdapter.waitTerminal(id, opts, ""),
      cancelWait: (id: string) =>
        terminalAdapter.cancelWait(id, ""),
    },
  });
  host.registerToolSet(upgradeToolSet, getUpgradeSlotDeclarations(resolveToolSetTools(upgradeToolSet).map((t) => t.name)));
}
