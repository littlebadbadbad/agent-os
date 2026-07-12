/**
 * extensions/terminal/agent/shell/index.ts — Barrel exports for the shell ToolSet
 */
export { createTerminalTools } from './tools';
export { createTerminalToolSet } from './toolSet';
export { createTerminalPluginAdapter } from './pluginAdapter';
export type { TerminalToolSet } from './toolSet';
export type {
  ShellFamily,
  TerminalEntry,
  AvailableShell,
  TerminalOutput,
  TerminalManagerAdapter,
} from './types';
