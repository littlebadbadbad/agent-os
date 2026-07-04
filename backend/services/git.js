/**
 * backend/lib/services/git.js — Git business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here: validation, parsing, formatting.
 * Transport layers (IPC, HTTP) only pass params and return the result.
 */

import { runGit, parseStatus, parseLog, validatePaths } from '../lib/git.js';

export async function getGitStatus() {
  const { output } = await runGit(['status', '--short']);
  return parseStatus(output);
}

export async function getGitDiff({ staged, paths } = {}) {
  const args = ['diff'];
  if (staged) args.push('--staged');
  if (paths?.length) { validatePaths(paths); args.push('--'); args.push(...paths); }
  const { output } = await runGit(args);
  return { output };
}

export async function getGitLog({ limit } = {}) {
  const n = Math.min(Math.max(parseInt(limit ?? '10', 10) || 10, 1), 100);
  const { output } = await runGit(['log', '--oneline', '--graph', `-n${n}`]);
  return { entries: parseLog(output) };
}

export async function stageGit({ paths } = {}) {
  const p = paths ?? [];
  validatePaths(p);
  const args = p.length ? ['add', ...p] : ['add', '-A'];
  const { success, output } = await runGit(args);
  if (!success) throw new Error(output);
  const status = await runGit(['status', '--short']);
  return { staged: parseStatus(status.output).staged.map((f) => f.path) };
}

export async function unstageGit({ paths } = {}) {
  const p = paths ?? [];
  validatePaths(p);
  const args = p.length ? ['restore', '--staged', ...p] : ['restore', '--staged', '.'];
  const { success, output } = await runGit(args);
  if (!success) throw new Error(output);
  return { unstaged: p.length ? p : ['.'] };
}

export async function commitGit({ message }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('message is required');
  }
  const msg = message.trim();
  const { success, output } = await runGit(['commit', '-m', msg]);
  if (!success) throw new Error(output);
  const hashMatch = output.match(/\[[\w\s/]+\s+([0-9a-f]+)\]/);
  return { hash: hashMatch?.[1] ?? 'unknown', subject: msg };
}

export async function discardGit({ paths }) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must be a non-empty array');
  }
  validatePaths(paths);
  const { success, output } = await runGit(['restore', ...paths]);
  if (!success) throw new Error(output);
  return { discarded: paths };
}
