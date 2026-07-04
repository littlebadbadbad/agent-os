/**
 * backend/lib/git.js — Shared Git utilities
 *
 * Pure business-logic helpers consumed by both HTTP routes and IPC
 * transport.  No HTTP, no IPC, no transport concerns whatsoever.
 *
 * Exported surface:
 *   runGit(args)         → Promise<{ success, output }>
 *   parseStatus(output)  → { staged, unstaged, untracked }
 *   parseLog(output)     → Array<{ hash, subject }>
 *   validatePaths(paths) → void (throws on invalid)
 *   SOURCE_ROOT          → absolute path of the git working tree root
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { PROJECT_ROOT } from './paths.js';

// ── Context ───────────────────────────────────────────────────────────────────

const IS_PKG = typeof process.pkg !== 'undefined';
export const SOURCE_ROOT = IS_PKG ? join(PROJECT_ROOT, '..') : PROJECT_ROOT;

// ── Path validation ───────────────────────────────────────────────────────────

/**
 * Reject absolute paths and any path segment that would escape the repo root.
 * @param {string[]} paths
 * @throws {Error}
 */
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

/**
 * Run a git command from SOURCE_ROOT and collect combined stdout+stderr.
 * @param {string[]} args
 * @returns {Promise<{ success: boolean; output: string }>}
 */
export function runGit(args) {
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn('git', args, {
      cwd: SOURCE_ROOT,
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

/**
 * Parse `git status --short` output into staged / unstaged / untracked buckets.
 * XY format: X = index status, Y = worktree status. '?' = untracked.
 * @param {string} output
 * @returns {{ staged: Array<{ path: string; status: string }>; unstaged: Array<{ path: string; status: string }>; untracked: string[] }}
 */
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

/**
 * Parse `git log --oneline --graph -n N` into structured entries.
 * @param {string} output
 * @returns {Array<{ hash: string; subject: string }>}
 */
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
