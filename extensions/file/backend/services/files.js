/**
 * extensions/file/backend/services/files.js — File-operation business API
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
import { readdir, stat, mkdir } from 'fs/promises';
import { statSync, existsSync } from 'fs';
import { join as nodeJoin, dirname as nodeDirname, resolve, isAbsolute } from 'path';

const IS_WIN = process.platform === 'win32';

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
 * Resolve the effective sandbox root for a request.
 *
 * When `explicitRoot` is given (the file panel UI browsing one of possibly
 * several open workspaces), it is used as-is. Otherwise the request falls
 * back to the single mutable "agent workspace root" that the
 * `get_workspace_root` / `set_workspace_root` tools manage — this keeps
 * agent tool behaviour completely unchanged.
 */
function resolveRoot(explicitRoot) {
  if (explicitRoot == null) return getWorkspaceRoot().root;
  if (typeof explicitRoot !== 'string' || !isAbsolute(explicitRoot)) {
    throw new Error(`root must be an absolute path, got: ${explicitRoot}`);
  }
  return resolve(explicitRoot);
}

export function getWorkspaceRootPath() {
  return getWorkspaceRoot();
}

export function setWorkspaceRootPath({ path }) {
  if (!path) throw new Error('path is required');
  return setWorkspaceRoot(path);
}

/**
 * Open (and create if missing) an arbitrary absolute directory for the UI
 * to browse as an independent workspace — does NOT touch the agent's
 * active workspace root.
 */
export async function openWorkspace({ path }) {
  if (!path) throw new Error('path is required');
  if (!isAbsolute(path)) throw new Error(`path must be an absolute path, got: ${path}`);
  const normalised = resolve(path);
  if (existsSync(normalised)) {
    const info = await stat(normalised);
    if (!info.isDirectory()) throw new Error(`path exists but is not a directory: ${normalised}`);
    return { root: normalised, created: false };
  }
  await mkdir(normalised, { recursive: true });
  return { root: normalised, created: true };
}

export function readFile({ root, path, startLine, endLine }) {
  if (!path) throw new Error('path is required');
  return sandboxRead(resolveRoot(root), path, startLine, endLine);
}

export async function writeFile({ root, path, content, attachment }) {
  if (!path) throw new Error('path is required');
  const activeRoot = resolveRoot(root);
  if (attachment?.data) {
    const result = await sandboxWriteBinary(activeRoot, path, attachment.data);
    return { path, ...result };
  }
  if (content === undefined || content === null) throw new Error('content or attachment.data is required');
  const result = await sandboxWrite(activeRoot, path, content);
  return { path, ...result };
}

export async function replaceInFile({ root, path, oldStr, newStr }) {
  if (!path) throw new Error('path is required');
  if (oldStr === undefined || oldStr === null) throw new Error('oldStr is required');
  if (newStr === undefined || newStr === null) throw new Error('newStr is required');
  const result = await sandboxStrReplace(resolveRoot(root), path, oldStr, newStr);
  return { path, ...result };
}

export async function replaceAllInFile({ root, path, oldStr, newStr }) {
  if (!path) throw new Error('path is required');
  if (oldStr === undefined || oldStr === null) throw new Error('oldStr is required');
  if (newStr === undefined || newStr === null) throw new Error('newStr is required');
  const result = await sandboxStrReplaceAll(resolveRoot(root), path, oldStr, newStr);
  return { path, ...result };
}

export function deleteFile({ root, path }) {
  if (!path) throw new Error('path is required');
  return sandboxDelete(resolveRoot(root), path);
}

export function moveFile({ root, from, to }) {
  if (!from) throw new Error('from is required');
  if (!to) throw new Error('to is required');
  return sandboxMove(resolveRoot(root), from, to);
}

export function listDirectory({ root, path, depth } = {}) {
  return sandboxListDir(resolveRoot(root), path, depth);
}

export function searchFiles({ root, pattern, content, maxResults, caseSensitive, contextLines, outputMode }) {
  if (!pattern) throw new Error('pattern is required');
  return sandboxSearch(resolveRoot(root), pattern, content, maxResults, { caseSensitive, contextLines, outputMode });
}

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
