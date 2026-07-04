/**
 * File sandbox — public entry point.
 *
 * Manages the mutable workspace root and re-exports all sandbox operations.
 * Sub-modules:
 *   config.js        — MAX_BYTES, BLOCKED_WRITE_EXTENSIONS, DEFAULT_IGNORE_DIRS
 *   path-security.js — sandboxPath, sandboxRealPath, typed errors
 *   ops.js           — sandboxRead, sandboxWrite, sandboxStrReplace, sandboxDelete, sandboxMove
 *   dir.js           — sandboxListDir, sandboxSearch
 */

import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { WORKSPACE_ROOT } from '../paths.js';
import { join } from 'path';
import { _setGetRoot as _setSecurityRoot } from './path-security.js';
import { _setGetRoot as _setDirRoot } from './dir.js';

// ── Active workspace root (mutable) ──────────────────────────────────────────────

// paths.js already resolves WORKSPACE_ROOT to an absolute path (respecting
// the $WORKSPACE_ROOT env var), so no additional resolve() call is needed.
let _activeRoot = WORKSPACE_ROOT;

/** Provide the getter callbacks to sub-modules that need the current root. */
_setSecurityRoot(() => _activeRoot);
_setDirRoot(() => _activeRoot);

// ── Public root API ───────────────────────────────────────────────────────────

/** Return the current workspace root (absolute, normalised). */
export function getWorkspaceRoot() {
  return _activeRoot;
}

/**
 * Switch the active workspace root to `absPath`.
 * Creates the directory if it does not exist.
 * Returns `{ root, created }`.
 * @param {string} absPath
 */
export async function setWorkspaceRoot(absPath) {
  if (typeof absPath !== 'string' || absPath.trim() === '') {
    throw new Error('absPath must be a non-empty string');
  }
  if (!isAbsolute(absPath)) {
    throw new Error(`absPath must be an absolute path, got: ${absPath}`);
  }

  const normalised = resolve(absPath);
  let created = false;

  if (existsSync(normalised)) {
    const info = await stat(normalised);
    if (!info.isDirectory()) {
      throw new Error(`path exists but is not a directory: ${normalised}`);
    }
  } else {
    await mkdir(normalised, { recursive: true });
    created = true;
  }

  _activeRoot = normalised;
  return { root: _activeRoot, created };
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export { SandboxNotFoundError, SandboxTooLargeError, sandboxPath, sandboxRealPath } from './path-security.js';
export { sandboxRead, sandboxWrite, sandboxWriteBinary, sandboxStrReplace, sandboxStrReplaceAll, sandboxDelete, sandboxMove } from './ops.js';
export { sandboxListDir, sandboxSearch } from './dir.js';
