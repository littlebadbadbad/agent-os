/**
 * src/tools/file/ipcAdapter.ts — Electron IPC adapter for file operations
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 */

import type {
  FileAdapter,
  ReadFileResult,
  WriteFileResult,
  StrReplaceResult,
  ReplaceAllResult,
  DeleteFileResult,
  MoveFileResult,
  ListDirResult,
  SearchFilesResult,
  WorkspaceRootResult,
} from './types';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcFileAdapterConfig = Record<string, never>;

/**
 * Create a `FileAdapter` that calls backend file operations via Electron IPC.
 *
 * Requires `window.electronAPI.invoke` to be available (exposed by preload).
 *
 * @example
 * ```ts
 * const adapter = createIpcFileAdapter();
 * const fileTools = createFileTools(adapter);
 * ```
 */
export function createIpcFileAdapter(
  _config: IpcFileAdapterConfig = {},
): FileAdapter {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcFileAdapter: window.electronAPI.invoke is not available');
  }

  return {
    readFile: ({ path, startLine, endLine }) =>
      invoke('files:read', { path, startLine, endLine }) as Promise<ReadFileResult>,

    writeFile: ({ path, content }) =>
      typeof content === 'object' && content.source === 'data'
        ? invoke('files:write', { path, attachment: { source: content.source, mimeType: content.mimeType, data: content.data } }) as Promise<WriteFileResult>
        : invoke('files:write', { path, content }) as Promise<WriteFileResult>,

    strReplace: ({ path, oldStr, newStr }) =>
      invoke('files:strReplace', { path, oldStr, newStr }) as Promise<StrReplaceResult>,

    replaceAll: ({ path, oldStr, newStr }) =>
      invoke('files:replaceAll', { path, oldStr, newStr }) as Promise<ReplaceAllResult>,

    deleteFile: ({ path }) =>
      invoke('files:delete', { path }) as Promise<DeleteFileResult>,

    moveFile: ({ from, to }) =>
      invoke('files:move', { from, to }) as Promise<MoveFileResult>,

    listDir: ({ path, depth } = {} as never) =>
      invoke('files:listDir', { path, depth }) as Promise<ListDirResult>,

    searchFiles: ({ pattern, content, maxResults, caseSensitive, contextLines, outputMode }) =>
      invoke('files:search', { pattern, content, maxResults, caseSensitive, contextLines, outputMode }) as Promise<SearchFilesResult>,

    getWorkspaceRoot: () =>
      invoke('files:workspaceGet') as Promise<WorkspaceRootResult>,

    setWorkspaceRoot: ({ path }) =>
      invoke('files:workspaceSet', { path }) as Promise<WorkspaceRootResult>,
  };
}
