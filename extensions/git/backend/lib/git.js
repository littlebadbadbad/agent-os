/**
 * extensions/git/backend/lib/git.js — Shared Git utilities
 *
 * Pure business-logic helpers. No HTTP, no IPC, no transport concerns.
 *
 * Exported surface:
 *   runGit(args)         => Promise<{ success, output }>
 *   parseStatus(output)  => { staged, unstaged, untracked }
 *   parseLog(output)     => Array<{ hash, subject }>
 *   validatePaths(paths) => void (throws on invalid)
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

// ── Context ───────────────────────────────────────────────────────────────────

/** Resolve the git working tree root. */
let _cwd = determineCwd();

function determineCwd() {
  if (typeof process.pkg !== 'undefined') {
    return join(process.execPath, '..', '..');
  }
  if (process.env.UAP_EXE_DIR) {
    return process.env.UAP_IS_PACKAGED === '1'
      ? join(process.env.UAP_EXE_DIR, '..')
      : process.env.UAP_EXE_DIR;
  }
  // Fall back to project root
  return join(new URL('..', import.meta.url).pathname, '..', '..', '..', '..');
}

export function getGitCwd() {
  return _cwd;
}

export function setGitCwd(dir) {
  if (!existsSync(dir)) throw new Error(`Git root not found: ${dir}`);
  _cwd = dir;
}

// ── Path validation ───────────────────────────────────────────────────────────

export function validatePaths(paths) {
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error(`Invalid path: ${JSON.stringify(p)}`);
    }
    if (/\.\./.test(p) || /^[/\\]/.test(p) || /^[A-Za-z]:/.test(p)) {
      throw new Error(`Path not allowed (traversal or absolute): ${p}`);
    }
  }
}

// ── Git runner ────────────────────────────────────────────────────────────────

export function runGit(args) {
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn('git', args, {
      cwd: _cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', (c) => chunks.push(c.toString()));
    child.stderr.on('data', (c) => chunks.push(c.toString()));
    child.on('close', (code) => resolve({ success: code === 0, output: chunks.join('') }));
    child.on('error', (err) => resolve({ success: false, output: `[error] ${err.message}` }));
  });
}

// ── Output parsers ────────────────────────────────────────────────────────────

export function parseStatus(output) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  for (const line of output.split('\n')) {
    if (!line || line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const file = line.slice(3).trim();
    if (!file) continue;
    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push({ path: file, status: x });
      if (y !== ' ' && y !== '?') unstaged.push({ path: file, status: y });
    }
  }
  return { staged, unstaged, untracked };
}

export function parseLog(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const clean = line.replace(/^[|\\/*\s]+/, '');
      const spaceIdx = clean.indexOf(' ');
      if (spaceIdx === -1) return null;
      return { hash: clean.slice(0, spaceIdx), subject: clean.slice(spaceIdx + 1).trim() };
    })
    .filter(Boolean);
}
