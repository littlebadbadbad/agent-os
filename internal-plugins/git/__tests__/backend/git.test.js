/**
 * Tests for extensions/git/backend/services/git.js and lib/git.js
 *
 * All git commands are mocked via child_process.spawn — no real git execution.
 *
 * Covered:
 *   validatePaths()   — valid, empty string, non-string, traversal, absolute
 *   parseStatus()     — staged, unstaged, untracked, both, empty, short lines
 *   parseLog()        — normal, graph chars, no-space lines, empty
 *   getStatus()       — service returns parsed status
 *   getDiff()         — service delegates diff with staged/paths flags
 *   getLog()          — service parses log entries with limit
 *   stage()           — service stages paths and returns list
 *   unstage()         — service unstages paths
 *   commit()          — service commits with message
 *   discard()         — service discards with paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock child_process ───────────────────────────────────────────────────────

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...a) => {
    const child = spawnMock(...a);
    if (child && '_autoError' in child) {
      process.nextTick(() => child.emit('error', new Error(child._autoError)));
    } else if (child && '_autoOutput' in child) {
      process.nextTick(() => {
        if (child._autoOutput) child.stdout.emit('data', child._autoOutput);
        child.emit('close', child._autoExitCode ?? 0);
      });
    }
    return child;
  },
}));

import * as svc from '../../backend/services/git.js';
import { validatePaths, parseStatus, parseLog, runGit, setGitCwd } from '../../backend/lib/git.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeGitChild(output = '', exitCode = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child._autoOutput = output;
  child._autoExitCode = exitCode;
  return child;
}

function makeErrorChild(message = 'git: command not found') {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child._autoError = message;
  return child;
}

beforeEach(() => vi.clearAllMocks());

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
// runGit
// ═══════════════════════════════════════════════════════════════════════════════

describe('runGit', () => {
  it('resolves with success and output when git succeeds', async () => {
    spawnMock.mockReturnValue(makeGitChild('output text', 0));
    const result = await runGit(['status']);
    expect(result).toEqual({ success: true, output: 'output text' });
    expect(spawnMock).toHaveBeenCalledWith('git', ['status'], expect.any(Object));
  });

  it('resolves with failure output when git exits non-zero', async () => {
    spawnMock.mockReturnValue(makeGitChild('error message', 1));
    const result = await runGit(['log']);
    expect(result.success).toBe(false);
    expect(result.output).toContain('error message');
  });

  it('resolves with error when spawn fails', async () => {
    spawnMock.mockReturnValue(makeErrorChild('ENOENT'));
    const result = await runGit(['xyz']);
    expect(result.success).toBe(false);
    expect(result.output).toContain('ENOENT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getStatus (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getStatus service', () => {
  it('returns empty buckets for a clean working tree', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const result = await svc.getStatus();
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('returns parsed staged files', async () => {
    spawnMock.mockReturnValue(makeGitChild('M  src/foo.ts\nA  src/bar.ts\n'));
    const result = await svc.getStatus();
    expect(result.staged).toHaveLength(2);
    expect(result.staged[0].path).toBe('src/foo.ts');
  });

  it('returns parsed untracked files', async () => {
    spawnMock.mockReturnValue(makeGitChild('?? new-file.ts\n'));
    const result = await svc.getStatus();
    expect(result.untracked).toEqual(['new-file.ts']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDiff (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDiff service', () => {
  it('returns diff output for unstaged changes', async () => {
    spawnMock.mockReturnValue(makeGitChild('diff --git a/foo b/foo\n'));
    const result = await svc.getDiff();
    expect(result.output).toContain('diff --git');
    const args = spawnMock.mock.calls[0][1];
    expect(args).not.toContain('--staged');
  });

  it('passes --staged when staged=true', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    await svc.getDiff({ staged: true });
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('--staged');
  });

  it('passes path args when paths provided', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    await svc.getDiff({ paths: ['src/foo.ts', 'src/bar.ts'] });
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('--');
    expect(args).toContain('src/foo.ts');
  });

  it('throws for traversal paths', async () => {
    await expect(svc.getDiff({ paths: ['../secret'] })).rejects.toThrow(/not allowed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getLog (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getLog service', () => {
  it('returns parsed log entries', async () => {
    spawnMock.mockReturnValue(makeGitChild('* abc1234 feat: add thing\n* def5678 fix: bug\n'));
    const result = await svc.getLog();
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].hash).toBe('abc1234');
  });

  it('defaults to limit 10', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    await svc.getLog();
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n10');
  });

  it('honours a custom limit', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    await svc.getLog({ limit: 25 });
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n25');
  });

  it('clamps limit to 100', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    await svc.getLog({ limit: 500 });
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n100');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// stage (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('stage service', () => {
  it('stages specific paths', async () => {
    spawnMock
      .mockReturnValueOnce(makeGitChild('', 0))
      .mockReturnValueOnce(makeGitChild('M  src/foo.ts\n', 0));

    const result = await svc.stage({ paths: ['src/foo.ts'] });
    expect(result.staged).toContain('src/foo.ts');

    const firstCall = spawnMock.mock.calls[0][1];
    expect(firstCall).toContain('src/foo.ts');
    expect(firstCall).not.toContain('-A');
  });

  it('stages all changes when paths is empty', async () => {
    spawnMock
      .mockReturnValueOnce(makeGitChild('', 0))
      .mockReturnValueOnce(makeGitChild('M  src/foo.ts\n', 0));

    await svc.stage({ paths: [] });
    const firstCall = spawnMock.mock.calls[0][1];
    expect(firstCall).toContain('-A');
  });

  it('stages all when paths omitted', async () => {
    spawnMock
      .mockReturnValueOnce(makeGitChild('', 0))
      .mockReturnValueOnce(makeGitChild('', 0));

    await svc.stage({});
    expect(spawnMock.mock.calls[0][1]).toContain('-A');
  });

  it('throws for traversal paths', async () => {
    await expect(svc.stage({ paths: ['../outside'] })).rejects.toThrow(/not allowed/i);
  });

  it('throws when git add fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('fatal: error', 128));
    await expect(svc.stage({ paths: ['src/foo.ts'] })).rejects.toThrow('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// commit (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('commit service', () => {
  it('commits with the given message', async () => {
    spawnMock.mockReturnValue(makeGitChild('[main abc1234] feat', 0));
    const result = await svc.commit({ message: 'feat: my feature' });
    expect(result.hash).toBe('abc1234');
    expect(result.subject).toBe('feat: my feature');
    expect(spawnMock.mock.calls[0][1]).toContain('feat: my feature');
  });

  it('throws when message is empty', async () => {
    await expect(svc.commit({ message: '' })).rejects.toThrow('message is required');
  });

  it('throws when git commit fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('nothing to commit', 1));
    await expect(svc.commit({ message: 'test' })).rejects.toThrow('nothing to commit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// discard (service)
// ═══════════════════════════════════════════════════════════════════════════════

describe('discard service', () => {
  it('discards paths', async () => {
    spawnMock.mockReturnValue(makeGitChild('', 0));
    const result = await svc.discard({ paths: ['a.ts', 'b.ts'] });
    expect(result.discarded).toEqual(['a.ts', 'b.ts']);
    expect(spawnMock.mock.calls[0][1]).toEqual(['restore', 'a.ts', 'b.ts']);
  });

  it('throws when paths is empty', async () => {
    await expect(svc.discard({ paths: [] })).rejects.toThrow('non-empty');
  });

  it('throws when paths is missing', async () => {
    await expect(svc.discard({})).rejects.toThrow('non-empty');
  });

  it('throws for traversal paths', async () => {
    await expect(svc.discard({ paths: ['../outside'] })).rejects.toThrow(/not allowed/i);
  });

  it('throws when git restore fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('fatal: path error', 128));
    await expect(svc.discard({ paths: ['missing.ts'] })).rejects.toThrow('path error');
  });
});
