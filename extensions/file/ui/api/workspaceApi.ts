/**
 * extensions/file/ui/api/workspaceApi.ts — File panel workspace API client
 *
 * PURE BUSINESS LOGIC — talks only through the injected `PluginApiClient`
 * (`host.apiClient`), never `fetch`/IPC directly.
 *
 * All calls accept an explicit `root` (absolute path) so the panel can
 * browse several independent workspaces concurrently. Omitting `root`
 * would fall back to the agent's single active workspace on the backend —
 * the panel never relies on that fallback, it always passes `root`.
 */

import type { PluginApiClient } from '@agent-type';

// ── Response types ─────────────────────────────────────────────────────────────

export interface FileTreeNode {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly size?: number;
  readonly children?: readonly FileTreeNode[];
}

export interface BrowseDirEntry {
  readonly name: string;
  readonly path: string;
}

export interface BrowseDirResult {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly BrowseDirEntry[];
}

export interface ReadFileResult {
  readonly content: string;
  readonly size: number;
  readonly totalLines: number;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface WriteFileResult {
  readonly path: string;
  readonly written: number;
}

export interface WorkspaceResult {
  readonly root: string;
  readonly created?: boolean;
}

// ── API surface ─────────────────────────────────────────────────────────────────

export interface FileWorkspaceApi {
  /** The workspace root the `set_workspace_root` / `get_workspace_root` agent tools currently target. */
  getAgentWorkspace(): Promise<WorkspaceResult>;
  /** Open (creating if missing) an absolute directory as a UI-only workspace. Never touches the agent's root. */
  openWorkspace(absPath: string): Promise<WorkspaceResult>;
  /** List a directory's immediate children within the given workspace root. */
  listDir(root: string, path: string, depth?: number): Promise<readonly FileTreeNode[]>;
  /** Browse the server filesystem at any absolute path (used by the folder picker). */
  browseDir(path: string): Promise<BrowseDirResult>;
  /** Read a file's full content within the given workspace root. */
  readFile(root: string, path: string): Promise<ReadFileResult>;
  /** Write / overwrite a file within the given workspace root. */
  writeFile(root: string, path: string, content: string): Promise<WriteFileResult>;
}

export function createFileWorkspaceApi(apiClient: PluginApiClient): FileWorkspaceApi {
  return {
    async getAgentWorkspace() {
      return apiClient.call<WorkspaceResult>('getWorkspaceRoot');
    },

    async openWorkspace(absPath) {
      return apiClient.call<WorkspaceResult>('openWorkspace', { path: absPath });
    },

    async listDir(root, path, depth = 1) {
      // The backend's listDir returns the tree array directly (not wrapped
      // in `{ entries }`) — unlike browseDir. Do not destructure `.entries`
      // here: on an array that resolves to Array.prototype.entries (a
      // function), which then gets misused as a React state updater.
      return apiClient.call<readonly FileTreeNode[]>('listDir', { root, path, depth });
    },

    async browseDir(path) {
      return apiClient.call<BrowseDirResult>('browseDir', { path });
    },

    async readFile(root, path) {
      return apiClient.call<ReadFileResult>('readFile', { root, path });
    },

    async writeFile(root, path, content) {
      return apiClient.call<WriteFileResult>('writeFile', { root, path, content });
    },
  };
}
