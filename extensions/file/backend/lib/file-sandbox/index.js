/**
 * File sandbox — public entry point.
 *
 * Manages the mutable "agent workspace root" (the single root that the
 * `get_workspace_root` / `set_workspace_root` agent tools read and mutate)
 * and re-exports the root-parameterized sandbox operations.
 *
 * Callers that need to operate against a DIFFERENT root — e.g. the file
 * panel UI browsing several workspaces at once — simply pass that root
 * explicitly to the re-exported operations instead of relying on the
 * singleton below. See `services/files.js` for the resolution rule.
 */

import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { mkdir, stat } from 'fs/promises';

let _activeRoot = process.env.WORKSPACE_ROOT || (
  process.env.UAP_EXE_DIR
    ? (process.env.UAP_IS_PACKAGED === '1'
        ? resolve(process.env.UAP_EXE_DIR, '..', 'workspace')
        : resolve(process.env.UAP_EXE_DIR, 'workspace'))
    : resolve(process.cwd(), 'workspace')
);

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
