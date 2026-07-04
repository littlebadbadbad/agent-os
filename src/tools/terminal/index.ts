export type {
  ShellFamily,
  TerminalEntry,
  AvailableShell,
  TerminalOutput,
  TerminalManagerAdapter,
  HttpTerminalAdapterConfig,
} from './types';
export { createHttpTerminalAdapter } from './adapter';
export { createIpcTerminalAdapter } from './ipcAdapter';
export type { IpcTerminalAdapterConfig } from './ipcAdapter';
export { createTerminalTools } from './tools';
export { createTerminalToolSet } from './toolSet';
export type { TerminalToolSet } from './toolSet';
export { ansiToHtml, applyRawChunk, processCarriageReturns } from './ansiToHtml';
