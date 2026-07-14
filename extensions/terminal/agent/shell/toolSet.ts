/**
 * extensions/terminal/agent/shell/toolSet.ts — Terminal ToolSet factory
 *
 * Registers 7 terminal management tools (list, create, read, send, remove,
 * sleep, wait) and exposes the adapter as symbol-isolated state for UI
 * panel + toolCard slots.
 *
 * Moved from agent/toolSet.ts during plugin restructuring (Phase 1).
 */

import type { ToolSet, ToolSetContext, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { TerminalManagerAdapter } from './types';
import { createTerminalTools } from './tools';

// ── Symbol ────────────────────────────────────────────────────────────────────

export const TERMINAL_SYMBOL = Symbol('terminal');

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

function terminalDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === "running" ? `${info.name}…` : info.name;
  return { icon: "💻", label: "Terminal", summary, status: info.status };
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A ToolSet that bundles all terminal tools with the adapter reference that
 * powers the UI panel.
 *
 * The adapter is surfaced via `onGetSymbolState` under `state[TERMINAL_SYMBOL]`
 * so the UI can read it through `getPluginState()[1]`.
 */
export type TerminalToolSet = ToolSet & {
  readonly adapter: TerminalManagerAdapter;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the terminal ToolSet.
 *
 * Registers seven tools (`terminal_list`, `terminal_create`, `terminal_read`,
 * `terminal_send`, `terminal_remove`, `terminal_wait`, `terminal_sleep`) and
 * exposes the adapter as symbol-isolated state.
 *
 * No snapshot hooks are implemented — the adapter is not serialisable and
 * terminal sessions outlive conversation history.
 */
export function createTerminalToolSet(
  adapter: TerminalManagerAdapter,
): TerminalToolSet {
  const { tools, getSystemPrompt } = createTerminalTools(adapter);

  return {
    name: 'terminal',
    symbol: TERMINAL_SYMBOL,
    coreTools: ['terminal_list', 'terminal_create', 'terminal_send', 'terminal_read', 'terminal_wait'],
    tools,
    onGetSystemPrompt: getSystemPrompt,

    onGetSymbolState: (ctx: ToolSetContext) => ({
      type: 'terminal' as const,
      terminalAdapter: adapter,
      slots: [
        {
          type: 'panel' as const,
          label: 'Terminals',
          showTab: (scx) => scx.conversationId === MAIN_CONVERSATION_ID,
        },
        {
          type: 'toolCard' as const,
          toolNames: tools.map((t) => t.name),
        },
        {
          type: 'compactToolCard' as const,
          toolNames: tools.map((t) => t.name),
          getDescriptor: terminalDescriptor,
        },
      ] satisfies readonly PluginSlotDeclaration[],
    }),

    adapter,
  };
}
