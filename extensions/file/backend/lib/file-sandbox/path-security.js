/**
 * Sandbox path validation and typed errors.
 */

import { normalize, relative, join } from 'path';
import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { MAX_BYTES } from './config.js';

let _getRootFn;
export function _setGetRoot(fn) { _getRootFn = fn; }
function activeRoot() { return _getRootFn(); }

export class SandboxNotFoundError extends Error {
  constructor(path) { super(`not found: ${path}`); this.name = 'SandboxNotFoundError'; }
}

export class SandboxTooLargeError extends Error {
  constructor(path, bytes) {
    super(`file too large (${bytes} bytes, max ${MAX_BYTES}): ${path}`);
    this.name = 'SandboxTooLargeError';
  }
}

export function sandboxPath(unsafePath) {
  if (typeof unsafePath !== 'string' || unsafePath.trim() === '') {
    throw new Error('path must be a non-empty string');
  }
  const stripped = unsafePath.replace(/^([A-Za-z]:)?[\\/]+/, '');
  const root = activeRoot();
  const absolute = normalize(join(root, stripped));
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || rel.includes('/../')) {
    throw new Error(`path escapes workspace root: ${unsafePath}`);
  }
  return absolute;
}

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
