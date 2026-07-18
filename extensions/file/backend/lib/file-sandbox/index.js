/**
 * File sandbox — public entry point.
 *
 * Manages the mutable workspace root and re-exports all sandbox operations.
 */

import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { _setGetRoot as _setSecurityRoot } from './path-security.js';
import { _setGetRoot as _setDirRoot } from './dir.js';

let _activeRoot = process.env.WORKSPACE_ROOT || (
  process.env.UAP_EXE_DIR
    ? (process.env.UAP_IS_PACKAGED === '1'
        ? resolve(process.env.UAP_EXE_DIR, '..', 'workspace')
        : resolve(process.env.UAP_EXE_DIR, 'workspace'))
    : resolve(process.cwd(), 'workspace')
);

_setSecurityRoot(() => _activeRoot);
_setDirRoot(() => _activeRoot);

export function getWorkspaceRoot() {
  return { root: _activeRoot };
}

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

export { SandboxNotFoundError, SandboxTooLargeError, sandboxPath, sandboxRealPath } from './path-security.js';
export { sandboxRead, sandboxWrite, sandboxWriteBinary, sandboxStrReplace, sandboxStrReplaceAll, sandboxDelete, sandboxMove } from './ops.js';
export { sandboxListDir, sandboxSearch } from './dir.js';
