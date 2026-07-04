export { createGitToolSet } from './toolSet';
export { createHttpGitAdapter } from './httpAdapter';
export type { HttpGitAdapterConfig } from './httpAdapter';
export { createIpcGitAdapter } from './ipcAdapter';
export type { IpcGitAdapterConfig } from './ipcAdapter';
export type {
  GitAdapter,
  GitFileEntry,
  GitStatusResult,
  GitDiffResult,
  GitLogEntry,
  GitCommitResult,
} from './adapter';
