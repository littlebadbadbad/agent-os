/**
 * internal-apps/terminal/agent/types.ts — Terminal app barrel types
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
  WaitResult,
} from './shell/types';
