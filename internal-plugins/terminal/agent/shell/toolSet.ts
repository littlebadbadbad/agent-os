/**
 * internal-plugins/terminal/agent/shell/toolSet.ts — Terminal ToolSet factory
 *
 * Registers 7 terminal management tools (list, create, read, send, remove,
 * sleep, wait). The app slot renders an independent floating terminal window
 * using its own adapter created from host.apiClient (same pattern as browser).
 */

import type { ToolSet, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import type { TerminalManagerAdapter } from './types';
import { createTerminalTools } from './tools';

// ── Compact tool-card descriptor ─────────────────────────────────────────────

function terminalDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === "running" ? `${info.name}…` : info.name;
  return { icon: "💻", label: "Terminal", summary, status: info.status };
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the terminal ToolSet.
 *
 * Registers seven tools (`terminal_list`, `terminal_create`, `terminal_read`,
 * `terminal_send`, `terminal_remove`, `terminal_wait`, `terminal_sleep`) and
 * provides a system prompt for terminal syntax guidance.
 *
 * The adapter is NOT exposed via symbol state — the UI creates its own
 * adapter from host.apiClient, matching the browser plugin pattern.
 */
export function createTerminalToolSet(adapter: TerminalManagerAdapter): ToolSet {
  const { tools, getSystemPrompt } = createTerminalTools(adapter);

  return {
    name: 'terminal',
    coreTools: ['terminal_list', 'terminal_create', 'terminal_send', 'terminal_read', 'terminal_wait'],
    tools,
    onGetSystemPrompt: getSystemPrompt,
  };
}

// ── Slot declarations ────────────────────────────────────────────────────────

export function getTerminalSlotDeclarations(
  toolNames: readonly string[],
): readonly PluginSlotDeclaration[] {
  return [
    {
      type: 'app',
      icon: '💻',
      label: 'Terminal',
      defaultWidth: 900,
      defaultHeight: 550,
      resizable: true,
      minimizable: true,
    },
    {
      type: 'toolCard',
      toolNames,
    },
    {
      type: 'compactToolCard',
      toolNames,
      getDescriptor: terminalDescriptor,
    },
  ] satisfies readonly PluginSlotDeclaration[];
}
