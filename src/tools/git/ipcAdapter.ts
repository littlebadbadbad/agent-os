/**
 * src/tools/git/ipcAdapter.ts — Electron IPC adapter for git operations
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 */

import type {
  GitAdapter,
  GitStatusResult,
  GitDiffResult,
  GitLogEntry,
  GitCommitResult,
} from './adapter';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcGitAdapterConfig = Record<string, never>;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a `GitAdapter` that communicates with the Agent SDK backend via
 * Electron IPC instead of HTTP REST.
 *
 * @example
 * ```ts
 * const adapter = createIpcGitAdapter();
 * ```
 */
export function createIpcGitAdapter(_config: IpcGitAdapterConfig = {}): GitAdapter {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcGitAdapter: window.electronAPI.invoke is not available');
  }

  return {
    status() {
      return invoke('git:status') as Promise<GitStatusResult>;
    },

    diff({ staged = false, paths = [] } = {}) {
      return invoke('git:diff', { staged, paths }) as Promise<GitDiffResult>;
    },

    log(limit = 10) {
      return invoke('git:log', { limit }) as Promise<{ entries: GitLogEntry[] }>;
    },

    stage(paths) {
      return invoke('git:stage', { paths: paths ?? [] }) as Promise<{ staged: string[] }>;
    },

    unstage(paths) {
      return invoke('git:unstage', { paths: paths ?? [] }) as Promise<{ unstaged: string[] }>;
    },

    commit(message) {
      return invoke('git:commit', { message }) as Promise<GitCommitResult>;
    },

    discard(paths) {
      return invoke('git:discard', { paths }) as Promise<{ discarded: string[] }>;
    },
  };
}
