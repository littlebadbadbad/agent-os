/**
 * demo/api/files.ts — File system API adapter
 *
 * PURE BUSINESS LOGIC — ZERO direct fetch() calls.
 * All HTTP communication delegated to apiTransport.
 */

import { apiTransport } from '../transport';

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
  return apiTransport.get<WorkspaceResult>('/api/files/workspace');
}

/** Set the workspace root to an absolute path (creates dir if absent). */
export async function setWorkspace(absPath: string): Promise<WorkspaceResult> {
  return apiTransport.post<WorkspaceResult>('/api/files/workspace', { path: absPath });
}

/** List directory contents (relative path, '' for root). depth default = 1. */
export async function listDir(
  path: string,
  depth = 1,
): Promise<FileTreeNode[]> {
  const url = `/api/files/list?path=${encodeURIComponent(path)}&depth=${depth}`;
  const result = await apiTransport.get<{ path: string; workspaceRoot: string; entries: FileTreeNode[] }>(url);
  return result.entries;
}

/** Browse the server filesystem at any absolute path (for folder picker). */
export async function browseDir(path: string): Promise<BrowseDirResult> {
  const url = `/api/files/browse?path=${encodeURIComponent(path)}`;
  return apiTransport.get<BrowseDirResult>(url);
}

/** Read a file's content (relative path). */
export async function readFile(
  path: string,
  startLine?: number,
  endLine?: number,
): Promise<ReadFileResult> {
  let url = `/api/files/read?path=${encodeURIComponent(path)}`;
  if (startLine !== undefined) url += `&startLine=${startLine}`;
  if (endLine !== undefined) url += `&endLine=${endLine}`;
  return apiTransport.get<ReadFileResult>(url);
}

/** Write / overwrite a file with the given content. */
export async function writeFile(
  path: string,
  content: string,
): Promise<WriteFileResult> {
  return apiTransport.post<WriteFileResult>('/api/files/write', { path, content });
}
