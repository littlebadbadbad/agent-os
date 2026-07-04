/**
 * Sandbox path validation and typed errors.
 *
 * sandboxPath(unsafePath)      — resolve + validate, returns absolute path
 * sandboxRealPath(unsafePath)  — like sandboxPath but resolves symlinks too
 * SandboxNotFoundError         — thrown when a target path does not exist
 * SandboxTooLargeError         — thrown when a file exceeds MAX_BYTES
 *
 * Both functions read `_activeRoot` from the workspace module at call time so
 * they always reflect the latest `setWorkspaceRoot()` call.
 */

import { normalize, relative, join } from 'path';
import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { MAX_BYTES } from './config.js';

// Injected by file-sandbox/index.js at module init so this module does not need
// to import index.js (which would create a circular dependency).
let _getRootFn;
export function _setGetRoot(fn) { _getRootFn = fn; }
function activeRoot() { return _getRootFn(); }

// ── Typed errors ──────────────────────────────────────────────────────────────

export class SandboxNotFoundError extends Error {
  constructor(path) { super(`not found: ${path}`); this.name = 'SandboxNotFoundError'; }
}

export class SandboxTooLargeError extends Error {
  constructor(path, bytes) {
    super(`file too large (${bytes} bytes, max ${MAX_BYTES}): ${path}`);
    this.name = 'SandboxTooLargeError';
  }
}

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Resolve `unsafePath` relative to the active workspace root and verify it
 * remains inside the sandbox.
 *
 * Leading slashes and Windows drive letters are stripped so callers can pass
 * workspace-relative paths with a leading `/` (e.g. `/notes/todo.md`) and
 * have them treated as relative to the sandbox root.
 * @param {string} unsafePath
 */
export function sandboxPath(unsafePath) {
  if (typeof unsafePath !== 'string' || unsafePath.trim() === '') {
    throw new Error('path must be a non-empty string');
  }

  // Strip leading slashes / drive letters so callers cannot escape via absolute paths.
  const stripped = unsafePath.replace(/^([A-Za-z]:)?[\\/]+/, '');
  const root = activeRoot();
  const absolute = normalize(join(root, stripped));

  // Prefix check (fast, symlink-agnostic).
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || rel.includes('/../')) {
    throw new Error(`path escapes workspace root: ${unsafePath}`);
  }

  return absolute;
}

/**
 * Same as `sandboxPath` but also resolves symlinks via `realpath` and
 * re-validates the resolved path.  Use this for reads on existing files.
 * @param {string} unsafePath
 */
export async function sandboxRealPath(unsafePath) {
  const abs = sandboxPath(unsafePath);
  if (existsSync(abs)) {
    const real = await realpath(abs);
    const root = activeRoot();
    const rel = relative(root, real);
    if (rel.startsWith('..') || rel.includes('/../')) {
      throw new Error(`symlink escapes workspace root: ${unsafePath}`);
    }
    return real;
  }
  return abs;
}

