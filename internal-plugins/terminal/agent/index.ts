/**
 * internal-plugins/terminal/agent/index.ts — Barrel exports for the Terminal extension agent layer
 *
 * Re-exports from shell/ and upgrade/ ToolSet subdirectories.
 * UI-only utilities (ansiToHtml) live in the ui/ layer — import from there.
 */

export {
  createTerminalTools,
  createTerminalToolSet,
  createTerminalPluginAdapter,
} from './shell';
export type {
  ShellFamily,
  TerminalEntry,
  AvailableShell,
  TerminalOutput,
  TerminalManagerAdapter,
  WaitResult,
} from './shell';
export { processCarriageReturns } from './processCarriageReturns';
