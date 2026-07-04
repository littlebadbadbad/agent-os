/**
 * src/tools/file/ipcAdapter.ts — Electron IPC adapter for file operations
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 */

import type { FileAdapter } from './types';

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
  const invoke = (window as any).electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcFileAdapter: window.electronAPI.invoke is not available');
  }

  return {
    readFile: ({ path, startLine, endLine }) =>
      invoke('files:read', { path, startLine, endLine }),

    writeFile: ({ path, content }) =>
      typeof content === 'object' && content.source === 'data'
        ? invoke('files:write', { path, attachment: { source: content.source, mimeType: content.mimeType, data: content.data } })
        : invoke('files:write', { path, content }),

    strReplace: ({ path, oldStr, newStr }) =>
      invoke('files:strReplace', { path, oldStr, newStr }),

    replaceAll: ({ path, oldStr, newStr }) =>
      invoke('files:replaceAll', { path, oldStr, newStr }),

    deleteFile: ({ path }) =>
      invoke('files:delete', { path }),

    moveFile: ({ from, to }) =>
      invoke('files:move', { from, to }),

    listDir: ({ path, depth } = {} as never) =>
      invoke('files:listDir', { path, depth }),

    searchFiles: ({ pattern, content, maxResults, caseSensitive, contextLines, outputMode }) =>
      invoke('files:search', { pattern, content, maxResults, caseSensitive, contextLines, outputMode }),

    getWorkspaceRoot: () =>
      invoke('files:workspaceGet'),

    setWorkspaceRoot: ({ path }) =>
      invoke('files:workspaceSet', { path }),
  };
}
