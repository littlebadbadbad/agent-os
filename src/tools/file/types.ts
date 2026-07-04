// ── Return-type contracts ─────────────────────────────────────────────────────

import type { DataAttachment } from '@agent-type';

export type ReadFileResult = {
  content: string;
  size: number;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
};

export type WriteFileResult = {
  path: string;
  written: number;
};

export type StrReplaceResult = {
  path: string;
  replaced: number;
};

export type ReplaceAllResult = {
  path: string;
  /** Number of occurrences replaced. */
  replaced: number;
};

export type DeleteFileResult = {
  deleted: string;
};

export type MoveFileResult = {
  moved: { from: string; to: string };
};

export type DirEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  children?: DirEntry[];
};

export type ListDirResult = {
  path: string;
  workspaceRoot: string;
  entries: DirEntry[];
};

export type SearchMatch = {
  file: string;
  line: number;
  content: string;
  context: string[];
};

export type SearchFilesResult = {
  pattern: string;
  /** Present when outputMode is 'files' (default). */
  files?: string[];
  /** Present when outputMode is 'content'. */
  results?: SearchMatch[];
  count: number;
};

export type WorkspaceRootResult = {
  root: string;
  /** True when the directory was newly created by setWorkspaceRoot. */
  created?: boolean;
};

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * File-system adapter injected into `createFileTools`.
 *
 * Implement this interface to provide any backing store: a remote REST API,
 * the browser Origin Private File System (OPFS), Electron `fs`, a test double,
 * or anything else.
 */
export type FileAdapter = {
  readFile: (params: {
    path: string;
    startLine?: number;
    endLine?: number;
    sessionId: string;
  }) => Promise<ReadFileResult>;

  writeFile: (params: {
    path: string;
    content: string | DataAttachment;
    sessionId: string;
  }) => Promise<WriteFileResult>;

  strReplace: (params: {
    path: string;
    oldStr: string;
    newStr: string;
    sessionId: string;
  }) => Promise<StrReplaceResult>;

  replaceAll: (params: {
    path: string;
    oldStr: string;
    newStr: string;
    sessionId: string;
  }) => Promise<ReplaceAllResult>;

  deleteFile: (params: {
    path: string;
    sessionId: string;
  }) => Promise<DeleteFileResult>;

  moveFile: (params: {
    from: string;
    to: string;
    sessionId: string;
  }) => Promise<MoveFileResult>;

  listDir: (params: {
    path?: string;
    depth?: number;
    sessionId: string;
  }) => Promise<ListDirResult>;

  searchFiles: (params: {
    pattern: string;
    content?: string;
    maxResults?: number;
    caseSensitive?: boolean;
    contextLines?: number;
    outputMode?: 'files' | 'content' | 'count';
    sessionId: string;
  }) => Promise<SearchFilesResult>;

  getWorkspaceRoot: (params: { sessionId: string }) => Promise<WorkspaceRootResult>;

  setWorkspaceRoot: (params: {
    path: string;
    sessionId: string;
  }) => Promise<WorkspaceRootResult>;
};

// ── HTTP adapter config ───────────────────────────────────────────────────────

/**
 * Configuration for the built-in HTTP file adapter.
 */
export type HttpFileAdapterConfig = {
  /**
   * Base URL of the backend API server.
   * @default '/api'
   */
  baseUrl?: string;
};
