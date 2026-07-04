import type { ToolSet, ToolSetContext } from '@agent-type';
import type { TerminalManagerAdapter } from './types';
import { createTerminalTools } from './tools';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A ToolSet that bundles all terminal tools with the adapter reference that
 * powers the UI panel.
 *
 * The adapter is surfaced via `onGetState` so `AgentSessionState.terminalAdapter`
 * is populated without requiring a separate top-level config param.
 */
export type TerminalToolSet = ToolSet & {
  readonly adapter: TerminalManagerAdapter;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the terminal ToolSet.
 *
 * Registers five tools (`terminal_list`, `terminal_create`, `terminal_read`,
 * `terminal_send`, `terminal_remove`, `terminal_wait`) and exposes the adapter
 * as `terminalAdapter` in every session's state, making the Terminals panel
 * appear in the widget automatically.
 *
 * No snapshot hooks are implemented — the adapter is not serialisable and
 * terminal sessions outlive conversation history.
 *
 * @example
 * ```ts
 * const terminalToolSet = createTerminalToolSet(
 *   createHttpTerminalAdapter({ baseUrl: '/api' }),
 * );
 * const agent = createAgentClient({ handler, toolSets: [terminalToolSet] });
 * ```
 */
export function createTerminalToolSet(
  adapter: TerminalManagerAdapter,
): TerminalToolSet {
  const { tools, getSystemPrompt } = createTerminalTools(adapter);
  return {
    name: 'terminal',
    coreTools: ['terminal_list', 'terminal_create', 'terminal_send', 'terminal_read', 'terminal_wait'],
    tools,
    onGetSystemPrompt: getSystemPrompt,
    onGetState: (_ctx: ToolSetContext) => ({ terminalAdapter: adapter }),
    adapter,
  };
}
