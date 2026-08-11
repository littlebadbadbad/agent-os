/**
 * internal-apps/git/backend/services/git.js — Git business API
 *
 * One function per API method. ALL business logic lives here.
 * Command execution goes through the terminal app's cross-app service.
 */

import { parseStatus, parseLog, validatePaths, getGitCwd } from '../lib/git.js';

/** @import { TerminalService } from '@agent-type/services' */

/**
 * Create the git service, bound to a TerminalService for command execution.
 *
 * @param {TerminalService} terminal
 */
export function createGitService(terminal) {
  /**
   * Run a git command via the terminal service and return the result.
   * @param {readonly string[]} args
   * @returns {Promise<{ success: boolean, output: string }>}
   */
  async function runGit(args) {
    const result = await terminal.runCommand({
      command: 'git',
      args,
      cwd: getGitCwd(),
    });
    return { success: result.success, output: result.output };
  }

  async function getStatus() {
    const { output } = await runGit(['status', '--short']);
    return parseStatus(output);
  }

  async function getDiff({ staged, paths } = {}) {
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (paths?.length) { validatePaths(paths); args.push('--'); args.push(...paths); }
    const { output } = await runGit(args);
    return { output };
  }

  async function getLog({ limit } = {}) {
    const n = Math.min(Math.max(parseInt(limit ?? '10', 10) || 10, 1), 100);
    const { output } = await runGit(['log', '--oneline', '--graph', `-n${n}`]);
    return { entries: parseLog(output) };
  }

  async function stage({ paths } = {}) {
    const p = paths ?? [];
    validatePaths(p);
    const args = p.length ? ['add', ...p] : ['add', '-A'];
    const { success, output } = await runGit(args);
    if (!success) throw new Error(output);
    const status = await runGit(['status', '--short']);
    return { staged: parseStatus(status.output).staged.map((f) => f.path) };
  }

  async function unstage({ paths } = {}) {
    const p = paths ?? [];
    validatePaths(p);
    const args = p.length ? ['restore', '--staged', ...p] : ['restore', '--staged', '.'];
    const { success, output } = await runGit(args);
    if (!success) throw new Error(output);
    return { unstaged: p.length ? p : ['.'] };
  }

  async function commit({ message }) {
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new Error('message is required');
    }
    const msg = message.trim();
    const { success, output } = await runGit(['commit', '-m', msg]);
    if (!success) throw new Error(output);
    const hashMatch = output.match(/\[[\w\s/]+\s+([0-9a-f]+)\]/);
    return { hash: hashMatch?.[1] ?? 'unknown', subject: msg };
  }

  async function discard({ paths }) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('paths must be a non-empty array');
    }
    validatePaths(paths);
    const { success, output } = await runGit(['restore', ...paths]);
    if (!success) throw new Error(output);
    return { discarded: paths };
  }

  return { getStatus, getDiff, getLog, stage, unstage, commit, discard };
}
