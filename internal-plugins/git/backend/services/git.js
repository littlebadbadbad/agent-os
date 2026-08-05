/**
 * internal-plugins/git/backend/services/git.js — Git business API
 *
 * One function per API method. ALL business logic lives here.
 */

import { runGit, parseStatus, parseLog, validatePaths } from '../lib/git.js';

export async function getStatus() {
  const { output } = await runGit(['status', '--short']);
  return parseStatus(output);
}

export async function getDiff({ staged, paths } = {}) {
  const args = ['diff'];
  if (staged) args.push('--staged');
  if (paths?.length) { validatePaths(paths); args.push('--'); args.push(...paths); }
  const { output } = await runGit(args);
  return { output };
}

export async function getLog({ limit } = {}) {
  const n = Math.min(Math.max(parseInt(limit ?? '10', 10) || 10, 1), 100);
  const { output } = await runGit(['log', '--oneline', '--graph', `-n${n}`]);
  return { entries: parseLog(output) };
}

export async function stage({ paths } = {}) {
  const p = paths ?? [];
  validatePaths(p);
  const args = p.length ? ['add', ...p] : ['add', '-A'];
  const { success, output } = await runGit(args);
  if (!success) throw new Error(output);
  const status = await runGit(['status', '--short']);
  return { staged: parseStatus(status.output).staged.map((f) => f.path) };
}

export async function unstage({ paths } = {}) {
  const p = paths ?? [];
  validatePaths(p);
  const args = p.length ? ['restore', '--staged', ...p] : ['restore', '--staged', '.'];
  const { success, output } = await runGit(args);
  if (!success) throw new Error(output);
  return { unstaged: p.length ? p : ['.'] };
}

export async function commit({ message }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('message is required');
  }
  const msg = message.trim();
  const { success, output } = await runGit(['commit', '-m', msg]);
  if (!success) throw new Error(output);
  const hashMatch = output.match(/\[[\w\s/]+\s+([0-9a-f]+)\]/);
  return { hash: hashMatch?.[1] ?? 'unknown', subject: msg };
}

export async function discard({ paths }) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must be a non-empty array');
  }
  validatePaths(paths);
  const { success, output } = await runGit(['restore', ...paths]);
  if (!success) throw new Error(output);
  return { discarded: paths };
}
