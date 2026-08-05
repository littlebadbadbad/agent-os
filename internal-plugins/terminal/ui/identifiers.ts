/**
 * internal-plugins/terminal/ui/identifiers.ts
 *
 * Tool name detection helpers — determines which tools belong to terminal.
 */

/** Terminal tool names that this plugin's UI handles. */
export const TERMINAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'terminal_list',
  'terminal_create',
  'terminal_read',
  'terminal_send',
  'terminal_remove',
  'terminal_wait',
  'terminal_sleep',
]);

export function isTerminalTool(name: string): boolean {
  return name.startsWith('terminal_');
}
