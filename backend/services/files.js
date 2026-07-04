/**
 * backend/lib/services/files.js — File-operation business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here: validation, formatting, response shaping.
 */

import {
  sandboxRead,
  sandboxWrite,
  sandboxStrReplace,
  sandboxStrReplaceAll,
  sandboxDelete,
  sandboxMove,
  sandboxListDir,
  sandboxSearch,
  sandboxWriteBinary,
  getWorkspaceRoot,
  setWorkspaceRoot,
} from '../lib/file-sandbox/index.js';

export function readFile({ path, startLine, endLine }) {
  if (!path) throw new Error('path is required');
  return sandboxRead(path, startLine, endLine);
}

export async function writeFile({ path, content, attachment }) {
  if (!path) throw new Error('path is required');
  if (attachment?.data) {
    const result = await sandboxWriteBinary(path, attachment.data);
    return { path, ...result };
  }
  if (content === undefined || content === null) throw new Error('content or attachment.data is required');
  const result = await sandboxWrite(path, content);
  return { path, ...result };
}

export async function replaceInFile({ path, oldStr, newStr }) {
  if (!path) throw new Error('path is required');
  if (oldStr === undefined || oldStr === null) throw new Error('oldStr is required');
  if (newStr === undefined || newStr === null) throw new Error('newStr is required');
  const result = await sandboxStrReplace(path, oldStr, newStr);
  return { path, ...result };
}

export async function replaceAllInFile({ path, oldStr, newStr }) {
  if (!path) throw new Error('path is required');
  if (oldStr === undefined || oldStr === null) throw new Error('oldStr is required');
  if (newStr === undefined || newStr === null) throw new Error('newStr is required');
  const result = await sandboxStrReplaceAll(path, oldStr, newStr);
  return { path, ...result };
}

export function deleteFile({ path }) {
  if (!path) throw new Error('path is required');
  return sandboxDelete(path);
}

export function moveFile({ from, to }) {
  if (!from) throw new Error('from is required');
  if (!to) throw new Error('to is required');
  return sandboxMove(from, to);
}

export function listDirectory({ path, depth } = {}) {
  return sandboxListDir(path, depth);
}

export function searchFiles({ pattern, content, maxResults, caseSensitive, contextLines, outputMode }) {
  if (!pattern) throw new Error('pattern is required');
  return sandboxSearch(pattern, { content, maxResults, caseSensitive, contextLines, outputMode });
}

export function getWorkspaceRootPath() {
  return getWorkspaceRoot();
}

export function setWorkspaceRootPath({ path }) {
  if (!path) throw new Error('path is required');
  return setWorkspaceRoot(path);
}

// ── Filesystem browser (real FS, not sandboxed) ────────────────────────────────

import { readdir, stat } from 'fs/promises';
import { statSync, existsSync } from 'fs';
import { join as nodeJoin, dirname as nodeDirname } from 'path';

const IS_WIN = process.platform === 'win32';

/** List available Windows drive letters. */
function getWindowsDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    try {
      const stats = statSync(`${letter}:\\`);
      if (stats.isDirectory()) drives.push({ name: `${letter}:\\`, path: `${letter}:\\` });
    } catch { /* drive not available */ }
  }
  return drives;
}

/**
 * Browse a directory on the real filesystem.
 *
 * @param {string}  browsePath  - absolute path to browse, or '' for root
 * @returns {{ path: string, parent: string|null, entries: Array<{ name: string, path: string }> }}
 * @throws {Error} if the directory cannot be read
 */
export async function browseDirectory(browsePath = '') {
  if (IS_WIN && !browsePath) {
    return { path: '', parent: null, entries: getWindowsDrives() };
  }
  const targetPath = browsePath || '/';
  const entries = [];
  const names = await readdir(targetPath);
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const fullPath = nodeJoin(targetPath, name);
      const st = await stat(fullPath);
      if (st.isDirectory()) entries.push({ name, path: fullPath });
    } catch { /* skip */ }
  }
  const parent = nodeDirname(targetPath);
  return {
    path: targetPath,
    parent: parent === targetPath ? null : parent,
    entries,
  };
}
