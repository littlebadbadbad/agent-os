/**
 * extensions/devops/backend/services/workspace-fs.js — Workspace file operations
 *
 * Lightweight filesystem operations for the devops editor.
 * These are registered via host.defineApi() in the devops backend.
 *
 * Workspace root is mutable — set via setWorkspaceRoot.
 * All read/write/list operations resolve relative paths within the root.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'fs';
import { join, resolve, relative, sep, isAbsolute } from 'path';

let _activeRoot = '';

/** Resolve a relative path within the workspace root. */
function resolvePath(path) {
  if (!_activeRoot) {
    throw new Error('Workspace root not set — call setWorkspaceRoot first');
  }
  const resolved = resolve(_activeRoot, path);
  // Prevent path traversal outside workspace root.
  const rel = relative(_activeRoot, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${path}" escapes workspace root`);
  }
  return resolved;
}

export const workspaceFs = {
  getWorkspaceRoot() {
    return { root: _activeRoot };
  },

  setWorkspaceRoot(params) {
    const absPath = params?.path;
    if (!absPath || typeof absPath !== 'string') {
      throw new Error('"path" is required');
    }
    const resolved = resolve(absPath);
    if (!existsSync(resolved)) {
      mkdirSync(resolved, { recursive: true });
    }
    _activeRoot = resolved;
    return { root: _activeRoot, created: !existsSync(resolved) };
  },

  listDir(params) {
    const relPath = params?.path ?? '';
    const depth = params?.depth ?? 1;

    const resolved = _activeRoot ? resolvePath(relPath) : resolve(relPath);
    const entries = listDirRecursive(resolved, '', depth);
    return { path: relPath, workspaceRoot: _activeRoot, entries };
  },

  browseDir(params) {
    const absPath = params?.path ?? (_activeRoot || (process.platform === 'win32' ? '' : '/'));
    const entries = browseDirEntries(absPath);
    const parent = getParentPath(absPath);
    return { path: absPath, parent, entries };
  },

  readFile(params) {
    const { path: relPath, startLine, endLine } = params ?? {};
    if (!relPath) throw new Error('"path" is required');
    const resolved = resolvePath(relPath);
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
      throw new Error(`File not found: ${relPath}`);
    }
    const content = readFileSync(resolved, 'utf-8');
    const totalLines = content.split('\n').length;
    const stat = statSync(resolved);

    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = startLine ?? 1;
      const end = endLine ?? lines.length;
      const sliced = lines.slice(start - 1, end).join('\n');
      return { path: relPath, content: sliced, size: stat.size, totalLines, startLine: start, endLine: end };
    }

    return { path: relPath, content, size: stat.size, totalLines };
  },

  writeFile(params) {
    const { path: relPath, content } = params ?? {};
    if (!relPath || typeof content !== 'string') {
      throw new Error('"path" (string) and "content" (string) are required');
    }
    const resolved = resolvePath(relPath);
    const dir = resolved.substring(0, resolved.lastIndexOf(sep));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(resolved, content, 'utf-8');
    const stat = statSync(resolved);
    return { path: relPath, written: stat.size };
  },
};

// ── Recursive directory listing ────────────────────────────────────────────────

function listDirRecursive(absDir, relPrefix, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  if (!existsSync(absDir)) return [];

  const entries = [];
  try {
    const names = readdirSync(absDir);
    for (const name of names) {
      const childAbs = join(absDir, name);
      const childRel = relPrefix ? `${relPrefix}/${name}` : name;
      const stat = statSync(childAbs);
      if (stat.isDirectory()) {
        const children = currentDepth < maxDepth
          ? listDirRecursive(childAbs, childRel, maxDepth, currentDepth + 1)
          : undefined;
        entries.push({ name: childRel, type: 'directory', children });
      } else {
        entries.push({ name: childRel, type: 'file', size: stat.size });
      }
    }
  } catch { /* permission denied, skip */ }
  return entries;
}

// ── Browse helpers ─────────────────────────────────────────────────────────────

function browseDirEntries(absPath) {
  if (!absPath || absPath === '') {
    // Windows: list drives
    if (process.platform === 'win32') {
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => {
        const drive = `${l}:\\`;
        try {
          const size = statSync(drive).size;
          return { name: drive, path: drive, type: 'drive' };
        } catch { return null; }
      }).filter(Boolean);
    }
    return [{ name: '/', path: '/', type: 'directory' }];
  }

  if (!existsSync(absPath)) return [];

  const entries = [];
  try {
    const names = readdirSync(absPath);
    for (const name of names) {
      const childAbs = join(absPath, name);
      try {
        const s = statSync(childAbs);
        entries.push({ name, path: childAbs, type: s.isDirectory() ? 'directory' : 'file' });
      } catch { /* skip */ }
    }
  } catch { /* permission denied */ }
  return entries;
}

function getParentPath(absPath) {
  if (!absPath || absPath === '' || absPath === '/') return null;
  const parent = resolve(absPath, '..');
  return parent === absPath ? null : parent;
}
