/**
 * extensions/devops/ui/api/files.ts — Workspace file operations
 *
 * PURE BUSINESS LOGIC — ZERO direct fetch/apiTransport calls.
 * All API communication goes through PluginApiClient via the
 * super built-in plugin dual-transport (HTTP/IPC) mechanism.
 *
 * The backend methods are registered in extensions/devops/backend/index.js
 * via host.defineApi() — search for "Workspace / file operations" there.
 */

import { createPluginApiClient } from '../../../../agent-UI/plugin/apiClient';

const client = createPluginApiClient('devops');

// ── Response types ─────────────────────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
}

export interface BrowseDirEntry {
  name: string;
  path: string;
}

export interface BrowseDirResult {
  path: string;
  parent: string | null;
  entries: BrowseDirEntry[];
}

export interface ReadFileResult {
  path: string;
  content: string;
  size: number;
  totalLines: number;
  startLine?: number;
  endLine?: number;
}

export interface WriteFileResult {
  path: string;
  written: number;
}

export interface WorkspaceResult {
  root: string;
  created?: boolean;
}

// ── API functions ──────────────────────────────────────────────────────────────

/** Get the current workspace root path. */
export async function getWorkspace(): Promise<WorkspaceResult> {
  return client.call<WorkspaceResult>('getWorkspaceRoot');
}

/** Set the workspace root to an absolute path (creates dir if absent). */
export async function setWorkspace(absPath: string): Promise<WorkspaceResult> {
  return client.call<WorkspaceResult>('setWorkspaceRoot', { path: absPath });
}

/** List directory contents (relative path, '' for root). depth default = 1. */
export async function listDir(
  path: string,
  depth = 1,
): Promise<FileTreeNode[]> {
  const result = await client.call<{ path: string; workspaceRoot: string; entries: FileTreeNode[] }>('listDir', { path, depth });
  return result.entries;
}

/** Browse the server filesystem at any absolute path (for folder picker). */
export async function browseDir(path: string): Promise<BrowseDirResult> {
  return client.call<BrowseDirResult>('browseDir', { path });
}

/** Read a file's content (relative path). */
export async function readFile(
  path: string,
  startLine?: number,
  endLine?: number,
): Promise<ReadFileResult> {
  return client.call<ReadFileResult>('readFile', { path, startLine, endLine });
}

/** Write / overwrite a file with the given content. */
export async function writeFile(
  path: string,
  content: string,
): Promise<WriteFileResult> {
  return client.call<WriteFileResult>('writeFile', { path, content });
}

