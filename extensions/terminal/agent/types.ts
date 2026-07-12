/**
 * extensions/terminal/agent/types.ts — Terminal plugin barrel types
 *
 * Re-exports all types from the shell ToolSet so UI components can import
 * from `../agent/types` (the path expected by main.tsx, TerminalPanel, XtermView).
 */
export type {
  ShellFamily,
  TerminalEntry,
  AvailableShell,
  TerminalOutput,
  TerminalManagerAdapter,
} from './shell/types';
