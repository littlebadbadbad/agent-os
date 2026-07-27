/**
 * extensions/terminal/agent/shell/index.ts — Barrel exports for the shell ToolSet
 */
export { createTerminalTools } from './tools';
export { createTerminalToolSet } from './toolSet';
export { createTerminalPluginAdapter } from './pluginAdapter';
export { createReadCursor } from './cursor';
export type { TerminalToolSet } from './toolSet';
export type { ReadCursor } from './cursor';
export type {
  ShellFamily,
  TerminalEntry,
  AvailableShell,
  TerminalOutput,
  TerminalManagerAdapter,
  WaitResult,
} from './types';
