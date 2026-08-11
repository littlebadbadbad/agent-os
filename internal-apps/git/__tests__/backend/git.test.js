/**
 * Tests for internal-apps/git/backend/services/git.js and lib/git.js
 *
 * All git commands are mocked via a fake TerminalService — no real git
 * execution, no child_process.
 *
 * Covered:
 *   validatePaths()   — valid, empty string, non-string, traversal, absolute
 *   parseStatus()     — staged, unstaged, untracked, both, empty, short lines
 *   parseLog()        — normal, graph chars, no-space lines, empty
 *   getStatus()       — service returns parsed status
 *   getDiff()         — service delegates diff with staged/paths flags
 *   getLog()          — service parses log entries with limit
 *   stage()           — service stages paths and returns list
 *   commit()          — service commits with message
 *   discard()         — service discards with paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { validatePaths, parseStatus, parseLog, setGitCwd } from '../../backend/lib/git.js';
import { createGitService } from '../../backend/services/git.js';

// ── Fake TerminalService ─────────────────────────────────────────────────────

/**
 * Create a fake TerminalService whose runCommand returns canned results.
 *
 * @param {{ output?: string, exitCode?: number, success?: boolean }} [defaults]
 * @returns {{ service: import('@agent-type/services').TerminalService, runCommand: ReturnType<typeof vi.fn> }}
 */
function makeFakeTerminal(defaults = {}) {
  const runCommand = vi.fn(async (_params) => ({
    output: defaults.output ?? '',
    exitCode: defaults.exitCode ?? 0,
    success: defaults.success ?? (defaults.exitCode ?? 0) === 0,
    timedOut: false,
  }));
  return { runCommand, service: { runCommand } };
}

beforeEach(() => {
  vi.clearAllMocks();
  setGitCwd(process.cwd());
});

// ═══════════════════════════════════════════════════════════════════════════════
// validatePaths
// ═══════════════════════════════════════════════════════════════════════════════

describe('validatePaths', () => {
  it('accepts valid relative paths', () => {
    expect(() => validatePaths(['src/foo.ts', 'bar.js'])).not.toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => validatePaths([''])).toThrow(/Invalid path/);
  });

  it('rejects a non-string value', () => {
    expect(() => validatePaths([42])).toThrow(/Invalid path/);
  });

  it('rejects ../ traversal', () => {
    expect(() => validatePaths(['../escape'])).toThrow(/not allowed/);
  });

  it('rejects absolute Unix paths', () => {
    expect(() => validatePaths(['/etc/passwd'])).toThrow(/not allowed/);
  });

  it('rejects absolute Windows paths', () => {
    expect(() => validatePaths(['C:\\secret'])).toThrow(/not allowed/);
  });

  it('does not throw on empty array', () => {
    expect(() => validatePaths([])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseStatus', () => {
  it('returns empty buckets for empty input', () => {
    const result = parseStatus('');
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('parses staged files (M in index column)', () => {
    const result = parseStatus('M  src/foo.ts\nA  src/bar.ts\n');
    expect(result.staged).toEqual([
      { path: 'src/foo.ts', status: 'M' },
      { path: 'src/bar.ts', status: 'A' },
    ]);
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it('parses unstaged modified files (M in worktree column)', () => {
    const result = parseStatus(' M src/foo.ts\n');
    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([{ path: 'src/foo.ts', status: 'M' }]);
  });

  it('parses untracked files (??)', () => {
    const result = parseStatus('?? new-file.ts\n');
    expect(result.untracked).toEqual(['new-file.ts']);
    expect(result.staged).toEqual([]);
  });

  it('parses both staged and unstaged for partially-staged (MM)', () => {
    const result = parseStatus('MM src/foo.ts\n');
    expect(result.staged).toEqual([{ path: 'src/foo.ts', status: 'M' }]);
    expect(result.unstaged).toEqual([{ path: 'src/foo.ts', status: 'M' }]);
  });

  it('skips lines that are too short', () => {
    const result = parseStatus('M \n\n   \n');
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseLog
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseLog', () => {
  it('parses normal oneline log entries', () => {
    const result = parseLog('abc1234 feat: add thing\ndef5678 fix: bug\n');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ hash: 'abc1234', subject: 'feat: add thing' });
    expect(result[1]).toEqual({ hash: 'def5678', subject: 'fix: bug' });
  });

  it('strips graph decoration characters', () => {
    const result = parseLog('* abc1234 feat\n|\\\n| * def5678 fix\n');
    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe('abc1234');
  });

  it('filters lines without a space after hash', () => {
    const result = parseLog('* abc1234\n* def5678 normal commit\n');
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('def5678');
  });

  it('returns empty array for empty input', () => {
    expect(parseLog('')).toEqual([]);
  });

  it('filters empty lines from output', () => {
    const result = parseLog('abc1234 first\n\ndef5678 second\n');
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getStatus (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getStatus service', () => {
  it('returns empty buckets for a clean working tree', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    const result = await svc.getStatus();
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'git' }));
  });

  it('returns parsed staged files', async () => {
    const { service } = makeFakeTerminal({ output: 'M  src/foo.ts\nA  src/bar.ts\n' });
    const svc = createGitService(service);
    const result = await svc.getStatus();
    expect(result.staged).toHaveLength(2);
    expect(result.staged[0].path).toBe('src/foo.ts');
  });

  it('returns parsed untracked files', async () => {
    const { service } = makeFakeTerminal({ output: '?? new-file.ts\n' });
    const svc = createGitService(service);
    const result = await svc.getStatus();
    expect(result.untracked).toEqual(['new-file.ts']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDiff (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDiff service', () => {
  it('returns diff output for unstaged changes', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: 'diff --git a/foo b/foo\n' });
    const svc = createGitService(service);
    const result = await svc.getDiff();
    expect(result.output).toContain('diff --git');
    const args = runCommand.mock.calls[0][0].args;
    expect(args).not.toContain('--staged');
  });

  it('passes --staged when staged=true', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    await svc.getDiff({ staged: true });
    const args = runCommand.mock.calls[0][0].args;
    expect(args).toContain('--staged');
  });

  it('passes path args when paths provided', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    await svc.getDiff({ paths: ['src/foo.ts', 'src/bar.ts'] });
    const args = runCommand.mock.calls[0][0].args;
    expect(args).toContain('--');
    expect(args).toContain('src/foo.ts');
  });

  it('throws for traversal paths', async () => {
    const { service } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    await expect(svc.getDiff({ paths: ['../secret'] })).rejects.toThrow(/not allowed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getLog (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getLog service', () => {
  it('returns parsed log entries', async () => {
    const { service } = makeFakeTerminal({ output: '* abc1234 feat: add thing\n* def5678 fix: bug\n' });
    const svc = createGitService(service);
    const result = await svc.getLog();
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].hash).toBe('abc1234');
  });

  it('defaults to limit 10', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    await svc.getLog();
    const args = runCommand.mock.calls[0][0].args;
    expect(args).toContain('-n10');
  });

  it('honours a custom limit', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    await svc.getLog({ limit: 25 });
    const args = runCommand.mock.calls[0][0].args;
    expect(args).toContain('-n25');
  });

  it('clamps limit to 100', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    await svc.getLog({ limit: 500 });
    const args = runCommand.mock.calls[0][0].args;
    expect(args).toContain('-n100');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// stage (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('stage service', () => {
  it('stages specific paths', async () => {
    const { service, runCommand } = makeFakeTerminal();
    runCommand
      .mockResolvedValueOnce({ output: '', exitCode: 0, success: true, timedOut: false })
      .mockResolvedValueOnce({ output: 'M  src/foo.ts\n', exitCode: 0, success: true, timedOut: false });

    const svc = createGitService(service);
    const result = await svc.stage({ paths: ['src/foo.ts'] });
    expect(result.staged).toContain('src/foo.ts');

    const firstCallArgs = runCommand.mock.calls[0][0].args;
    expect(firstCallArgs).toContain('src/foo.ts');
    expect(firstCallArgs).not.toContain('-A');
  });

  it('stages all changes when paths is empty', async () => {
    const { service, runCommand } = makeFakeTerminal();
    runCommand
      .mockResolvedValueOnce({ output: '', exitCode: 0, success: true, timedOut: false })
      .mockResolvedValueOnce({ output: 'M  src/foo.ts\n', exitCode: 0, success: true, timedOut: false });

    const svc = createGitService(service);
    await svc.stage({ paths: [] });
    const firstCallArgs = runCommand.mock.calls[0][0].args;
    expect(firstCallArgs).toContain('-A');
  });

  it('stages all when paths omitted', async () => {
    const { service, runCommand } = makeFakeTerminal();
    runCommand
      .mockResolvedValueOnce({ output: '', exitCode: 0, success: true, timedOut: false })
      .mockResolvedValueOnce({ output: '', exitCode: 0, success: true, timedOut: false });

    const svc = createGitService(service);
    await svc.stage({});
    expect(runCommand.mock.calls[0][0].args).toContain('-A');
  });

  it('throws for traversal paths', async () => {
    const { service } = makeFakeTerminal();
    const svc = createGitService(service);
    await expect(svc.stage({ paths: ['../outside'] })).rejects.toThrow(/not allowed/i);
  });

  it('throws when git add fails', async () => {
    const { service, runCommand } = makeFakeTerminal();
    runCommand.mockResolvedValueOnce({ output: 'fatal: error', exitCode: 128, success: false, timedOut: false });

    const svc = createGitService(service);
    await expect(svc.stage({ paths: ['src/foo.ts'] })).rejects.toThrow('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// commit (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('commit service', () => {
  it('commits with the given message', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '[main abc1234] feat' });
    const svc = createGitService(service);
    const result = await svc.commit({ message: 'feat: my feature' });
    expect(result.hash).toBe('abc1234');
    expect(result.subject).toBe('feat: my feature');
    expect(runCommand.mock.calls[0][0].args).toContain('feat: my feature');
  });

  it('throws when message is empty', async () => {
    const { service } = makeFakeTerminal();
    const svc = createGitService(service);
    await expect(svc.commit({ message: '' })).rejects.toThrow('message is required');
  });

  it('throws when git commit fails', async () => {
    const { service, runCommand } = makeFakeTerminal();
    runCommand.mockResolvedValueOnce({ output: 'nothing to commit', exitCode: 1, success: false, timedOut: false });

    const svc = createGitService(service);
    await expect(svc.commit({ message: 'test' })).rejects.toThrow('nothing to commit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// discard (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('discard service', () => {
  it('discards paths', async () => {
    const { service, runCommand } = makeFakeTerminal({ output: '' });
    const svc = createGitService(service);
    const result = await svc.discard({ paths: ['a.ts', 'b.ts'] });
    expect(result.discarded).toEqual(['a.ts', 'b.ts']);
    expect(runCommand.mock.calls[0][0].args).toEqual(['restore', 'a.ts', 'b.ts']);
  });

  it('throws when paths is empty', async () => {
    const { service } = makeFakeTerminal();
    const svc = createGitService(service);
    await expect(svc.discard({ paths: [] })).rejects.toThrow('non-empty');
  });

  it('throws when paths is missing', async () => {
    const { service } = makeFakeTerminal();
    const svc = createGitService(service);
    await expect(svc.discard({})).rejects.toThrow('non-empty');
  });

  it('throws for traversal paths', async () => {
    const { service } = makeFakeTerminal();
    const svc = createGitService(service);
    await expect(svc.discard({ paths: ['../outside'] })).rejects.toThrow(/not allowed/i);
  });

  it('throws when git restore fails', async () => {
    const { service, runCommand } = makeFakeTerminal();
    runCommand.mockResolvedValueOnce({ output: 'fatal: path error', exitCode: 128, success: false, timedOut: false });

    const svc = createGitService(service);
    await expect(svc.discard({ paths: ['missing.ts'] })).rejects.toThrow('path error');
  });
});
