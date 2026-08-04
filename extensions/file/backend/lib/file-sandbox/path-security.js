/**
 * Sandbox path validation and typed errors.
 *
 * Every function takes the workspace `root` explicitly — there is no
 * module-level singleton here. This lets callers sandbox against many
 * independent roots concurrently (e.g. several UI workspaces open at once)
 * without any risk of cross-talk between them.
 */

import { normalize, relative, join } from 'path';
import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { MAX_BYTES } from './config.js';

export class SandboxNotFoundError extends Error {
  constructor(path) { super(`not found: ${path}`); this.name = 'SandboxNotFoundError'; }
}

export class SandboxTooLargeError extends Error {
  constructor(path, bytes) {
    super(`file too large (${bytes} bytes, max ${MAX_BYTES}): ${path}`);
    this.name = 'SandboxTooLargeError';
  }
}

export function sandboxPath(root, unsafePath) {
  if (typeof unsafePath !== 'string' || unsafePath.trim() === '') {
    throw new Error('path must be a non-empty string');
  }
  const stripped = unsafePath.replace(/^([A-Za-z]:)?[\\/]+/, '');
  const absolute = normalize(join(root, stripped));
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || rel.includes('/../')) {
    throw new Error(`path escapes workspace root: ${unsafePath}`);
  }
  return absolute;
}

export async function sandboxRealPath(root, unsafePath) {
  const abs = sandboxPath(root, unsafePath);
  if (existsSync(abs)) {
    const real = await realpath(abs);
    const rel = relative(root, real);
    if (rel.startsWith('..') || rel.includes('/../')) {
      throw new Error(`symlink escapes workspace root: ${unsafePath}`);
    }
    return real;
  }
  return abs;
}
