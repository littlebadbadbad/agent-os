/**
 * internal-apps/terminal/agent/activate.ts — Terminal app activation entry
 *
 * Registers TWO ToolSets on the agent host:
 *   1. Terminal ToolSet — PTY shell management (7 tools)
 *   2. Upgrade ToolSet — Self-upgrade workflow (7 tools)
 *
 * Follows the same multi-toolset pattern as user-input's activate.ts.
 */

import type { AgentAppHost } from '@agent-type';
import { resolveToolSetTools } from '@agent-type';
import { createTerminalAppAdapter, createTerminalToolSet } from './shell';
import { createUpgradeAppAdapter, createUpgradeToolSet } from './upgrade';
import { getTerminalSlotDeclarations } from './shell/toolSet';
import { getUpgradeSlotDeclarations } from './upgrade/toolSet';

/**
 * Activate the terminal app.
 *
 * Creates app adapters bound to the host's apiClient,
 * builds both ToolSets, and registers them on the agent.
 *
 * @param host  The AgentAppHost for this app.
 */
export function activate(host: AgentAppHost): void {
  // ── Terminal ToolSet ───────────────────────────────────────────────────
  const terminalAdapter = createTerminalAppAdapter(host.apiClient);
  const terminalToolSet = createTerminalToolSet(terminalAdapter);
  host.registerToolSet(terminalToolSet, getTerminalSlotDeclarations(resolveToolSetTools(terminalToolSet).map((t) => t.name)));

  // ── Upgrade ToolSet ────────────────────────────────────────────────────
  // Uses the same apiClient (pre-bound to 'terminal' app) for RPC calls,
  // plus the terminal adapter for terminal polling during build/dev/test.
  const upgradeAdapter = createUpgradeAppAdapter(host.apiClient);
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
