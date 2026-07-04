/**
 * Tests for backend/routes/git.js  (handleGitRoutes)
 *
 * All git commands are mocked via child_process.spawn — no real git execution.
 * logger is silenced.  No module-level state, so static imports suffice.
 *
 * Covered:
 *   validatePaths()   — valid, empty string, non-string, traversal, absolute
 *   parseStatus()     — staged, unstaged, untracked, both, empty, short lines
 *   parseLog()        — normal, graph chars, no-space lines, empty
 *   handleGitRoutes() — all seven routes, unmatched path, git failure cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Stable mocks ──────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../lib/paths.js', () => ({
  PROJECT_ROOT: '/fake/project',
}));

const spawnMock = vi.fn();
/**
 * Wrap spawn so that child events fire via process.nextTick AFTER spawn returns
 * (i.e. after the route has synchronously registered its listeners).
 * Children opt-in by setting _autoOutput/_autoExitCode or _autoError.
 */
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

import { handleGitRoutes } from '../transports/network/git.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: null,
    _headers: {},
    _body: null,
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h); },
    end(b) { this._body = b; },
    setHeader(k, v) { this._headers[k] = v; },
    json() { return JSON.parse(this._body); },
  };
}

function makeReq(method, body = null, url = '') {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  process.nextTick(() => {
    if (body !== null) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

/**
 * Create a fake child process that will emit `output` on stdout then close
 * with `exitCode` — but only once the spawn mock wrapper picks it up
 * (events are scheduled inside the spawn wrapper via process.nextTick).
 */
function makeGitChild(output = '', exitCode = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child._autoOutput = output;
  child._autoExitCode = exitCode;
  return child;
}

/** Create a child that emits an error event (scheduled via spawn wrapper). */
function makeErrorChild(message = 'git: command not found') {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child._autoError = message;
  return child;
}

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════════
// Unmatched path
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGitRoutes — unmatched path', () => {
  it('returns false for a non-git path', async () => {
    const result = await handleGitRoutes(makeReq('GET'), makeRes(), '/api/chat');
    expect(result).toBe(false);
  });

  it('returns false for /api/git without trailing /', async () => {
    const result = await handleGitRoutes(makeReq('GET'), makeRes(), '/api/git');
    expect(result).toBe(false);
  });

  it('returns false for an unknown /api/git/* route', async () => {
    const result = await handleGitRoutes(makeReq('GET'), makeRes(), '/api/git/unknown');
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/git/status
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/git/status', () => {
  it('returns empty buckets for a clean working tree', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/status');
    expect(res._status).toBe(200);
    expect(res.json()).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('parses staged files', async () => {
    spawnMock.mockReturnValue(makeGitChild('M  src/foo.ts\nA  src/bar.ts\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/status');
    const body = res.json();
    expect(body.staged).toEqual([
      { path: 'src/foo.ts', status: 'M' },
      { path: 'src/bar.ts', status: 'A' },
    ]);
    expect(body.unstaged).toEqual([]);
    expect(body.untracked).toEqual([]);
  });

  it('parses unstaged modified files', async () => {
    spawnMock.mockReturnValue(makeGitChild(' M src/foo.ts\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/status');
    const body = res.json();
    expect(body.staged).toEqual([]);
    expect(body.unstaged).toEqual([{ path: 'src/foo.ts', status: 'M' }]);
  });

  it('parses untracked files', async () => {
    spawnMock.mockReturnValue(makeGitChild('?? new-file.ts\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/status');
    const body = res.json();
    expect(body.untracked).toEqual(['new-file.ts']);
    expect(body.staged).toEqual([]);
    expect(body.unstaged).toEqual([]);
  });

  it('parses both staged and unstaged for a partially-staged file (MM)', async () => {
    spawnMock.mockReturnValue(makeGitChild('MM src/foo.ts\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/status');
    const body = res.json();
    expect(body.staged).toEqual([{ path: 'src/foo.ts', status: 'M' }]);
    expect(body.unstaged).toEqual([{ path: 'src/foo.ts', status: 'M' }]);
  });

  it('skips lines that are too short to be valid status entries', async () => {
    spawnMock.mockReturnValue(makeGitChild('M \n\n   \n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/status');
    expect(res.json()).toEqual({ staged: [], unstaged: [], untracked: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/git/diff
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/git/diff', () => {
  it('returns diff output for unstaged changes', async () => {
    spawnMock.mockReturnValue(makeGitChild('diff --git a/foo b/foo\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET'), res, '/api/git/diff');
    expect(res._status).toBe(200);
    expect(res.json().output).toContain('diff --git');
    // args should NOT include --staged
    const args = spawnMock.mock.calls[0][1];
    expect(args).not.toContain('--staged');
  });

  it('passes --staged flag when staged=true', async () => {
    spawnMock.mockReturnValue(makeGitChild('staged diff\n'));
    const res = makeRes();
    await handleGitRoutes(
      makeReq('GET', null, '/api/git/diff?staged=true'),
      res,
      '/api/git/diff',
    );
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('--staged');
  });

  it('passes -- and path args when paths= is provided', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const res = makeRes();
    await handleGitRoutes(
      makeReq('GET', null, '/api/git/diff?paths=src%2Ffoo.ts,src%2Fbar.ts'),
      res,
      '/api/git/diff',
    );
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('--');
    expect(args).toContain('src/foo.ts');
    expect(args).toContain('src/bar.ts');
  });

  it('returns 400 when paths contain a traversal segment', async () => {
    const res = makeRes();
    await handleGitRoutes(
      makeReq('GET', null, '/api/git/diff?paths=../secret'),
      res,
      '/api/git/diff',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/traversal|not allowed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/git/log
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/git/log', () => {
  it('returns parsed log entries', async () => {
    spawnMock.mockReturnValue(makeGitChild('* abc1234 feat: add thing\n* def5678 fix: bug\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET', null, '/api/git/log'), res, '/api/git/log');
    expect(res._status).toBe(200);
    expect(res.json().entries).toHaveLength(2);
    expect(res.json().entries[0].hash).toBe('abc1234');
    expect(res.json().entries[0].subject).toBe('feat: add thing');
  });

  it('defaults to limit=10', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET', null, '/api/git/log'), res, '/api/git/log');
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n10');
  });

  it('honours a custom limit', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET', null, '/api/git/log?limit=25'), res, '/api/git/log');
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n25');
  });

  it('clamps limit to 100', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET', null, '/api/git/log?limit=500'), res, '/api/git/log');
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n100');
  });

  it('uses default when limit is not a number', async () => {
    spawnMock.mockReturnValue(makeGitChild(''));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET', null, '/api/git/log?limit=abc'), res, '/api/git/log');
    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-n10');
  });

  it('skips log lines that have no space between hash and subject', async () => {
    spawnMock.mockReturnValue(makeGitChild('* abc1234\n* def5678 normal commit\n'));
    const res = makeRes();
    await handleGitRoutes(makeReq('GET', null, '/api/git/log'), res, '/api/git/log');
    // Line without a space after cleaning up graph chars should be filtered
    const entries = res.json().entries;
    expect(entries.some(e => e.hash === 'def5678')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/git/stage
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/git/stage', () => {
  it('stages specific paths and returns list of staged files', async () => {
    // First call: git add; second call: git status --short
    spawnMock
      .mockReturnValueOnce(makeGitChild('', 0))
      .mockReturnValueOnce(makeGitChild('M  src/foo.ts\n', 0));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['src/foo.ts'] }),
      res,
      '/api/git/stage',
    );

    expect(res._status).toBe(200);
    expect(res.json().staged).toContain('src/foo.ts');

    // git add was called with the specific path
    const firstCall = spawnMock.mock.calls[0][1];
    expect(firstCall).toContain('src/foo.ts');
    expect(firstCall).not.toContain('-A');
  });

  it('stages all changes when paths is empty', async () => {
    spawnMock
      .mockReturnValueOnce(makeGitChild('', 0))
      .mockReturnValueOnce(makeGitChild('M  src/foo.ts\nA  new.ts\n', 0));

    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: [] }), res, '/api/git/stage');

    const firstCall = spawnMock.mock.calls[0][1];
    expect(firstCall).toContain('-A');
  });

  it('stages all changes when paths key is absent', async () => {
    spawnMock
      .mockReturnValueOnce(makeGitChild('', 0))
      .mockReturnValueOnce(makeGitChild('', 0));

    const res = makeRes();
    await handleGitRoutes(makeReq('POST', {}), res, '/api/git/stage');

    const firstCall = spawnMock.mock.calls[0][1];
    expect(firstCall).toContain('-A');
  });

  it('returns 400 for paths with traversal', async () => {
    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['../outside'] }),
      res,
      '/api/git/stage',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/traversal|not allowed/i);
  });

  it('returns 400 for an empty-string path', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: [''] }), res, '/api/git/stage');
    expect(res._status).toBe(400);
  });

  it('returns 400 for a non-string in paths', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: [42] }), res, '/api/git/stage');
    expect(res._status).toBe(400);
  });

  it('returns 400 for an absolute path', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: ['/etc/passwd'] }), res, '/api/git/stage');
    expect(res._status).toBe(400);
  });

  it('returns 400 for a Windows absolute path', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: ['C:\\secret'] }), res, '/api/git/stage');
    expect(res._status).toBe(400);
  });

  it('returns 500 when git add fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('fatal: pathspec error', 128));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['src/foo.ts'] }),
      res,
      '/api/git/stage',
    );
    expect(res._status).toBe(500);
    expect(res.json().error).toContain('pathspec error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/git/unstage
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/git/unstage', () => {
  it('unstages specific paths', async () => {
    spawnMock.mockReturnValue(makeGitChild('', 0));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['src/foo.ts'] }),
      res,
      '/api/git/unstage',
    );

    expect(res._status).toBe(200);
    expect(res.json().unstaged).toContain('src/foo.ts');

    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('--staged');
    expect(args).toContain('src/foo.ts');
  });

  it('unstages everything when paths is empty', async () => {
    spawnMock.mockReturnValue(makeGitChild('', 0));

    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: [] }), res, '/api/git/unstage');

    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('.');
    expect(res.json().unstaged).toContain('.');
  });

  it('unstages everything when paths key is absent', async () => {
    spawnMock.mockReturnValue(makeGitChild('', 0));

    const res = makeRes();
    await handleGitRoutes(makeReq('POST', {}), res, '/api/git/unstage');

    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('.');
  });

  it('returns 400 for invalid paths', async () => {
    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['../bad'] }),
      res,
      '/api/git/unstage',
    );
    expect(res._status).toBe(400);
  });

  it('returns 500 when git restore --staged fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('error: pathspec', 1));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['src/foo.ts'] }),
      res,
      '/api/git/unstage',
    );
    expect(res._status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/git/commit
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/git/commit', () => {
  it('creates a commit and returns hash + subject', async () => {
    spawnMock.mockReturnValue(
      makeGitChild('[main abc1234] feat: my feature\n 1 file changed\n', 0),
    );

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { message: 'feat: my feature' }),
      res,
      '/api/git/commit',
    );

    expect(res._status).toBe(200);
    expect(res.json().hash).toBe('abc1234');
    expect(res.json().subject).toBe('feat: my feature');
  });

  it('returns "unknown" hash when commit output format is unexpected', async () => {
    spawnMock.mockReturnValue(makeGitChild('Committed successfully\n', 0));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { message: 'my commit' }),
      res,
      '/api/git/commit',
    );

    expect(res._status).toBe(200);
    expect(res.json().hash).toBe('unknown');
  });

  it('trims whitespace from the commit message', async () => {
    spawnMock.mockReturnValue(makeGitChild('[main abc1234] trimmed\n', 0));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { message: '  trimmed  ' }),
      res,
      '/api/git/commit',
    );

    const args = spawnMock.mock.calls[0][1];
    expect(args[args.length - 1]).toBe('trimmed');
  });

  it('returns 400 when message is missing', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', {}), res, '/api/git/commit');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/message.*required/i);
  });

  it('returns 400 when message is an empty string', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { message: '   ' }), res, '/api/git/commit');
    expect(res._status).toBe(400);
  });

  it('returns 400 when message is not a string', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { message: 42 }), res, '/api/git/commit');
    expect(res._status).toBe(400);
  });

  it('returns 500 when git commit fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('error: nothing to commit', 1));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { message: 'empty commit' }),
      res,
      '/api/git/commit',
    );
    expect(res._status).toBe(500);
    expect(res.json().error).toContain('nothing to commit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/git/discard
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/git/discard', () => {
  it('discards changes in specified files', async () => {
    spawnMock.mockReturnValue(makeGitChild('', 0));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['src/foo.ts', 'src/bar.ts'] }),
      res,
      '/api/git/discard',
    );

    expect(res._status).toBe(200);
    expect(res.json().discarded).toEqual(['src/foo.ts', 'src/bar.ts']);

    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('src/foo.ts');
    expect(args).toContain('src/bar.ts');
  });

  it('returns 400 when paths is empty', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', { paths: [] }), res, '/api/git/discard');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/non-empty/);
  });

  it('returns 400 when paths is absent', async () => {
    const res = makeRes();
    await handleGitRoutes(makeReq('POST', {}), res, '/api/git/discard');
    expect(res._status).toBe(400);
  });

  it('returns 400 for traversal paths', async () => {
    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['../etc/shadow'] }),
      res,
      '/api/git/discard',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/not allowed/i);
  });

  it('returns 400 for a backslash-absolute path', async () => {
    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['\\windows\\secret'] }),
      res,
      '/api/git/discard',
    );
    expect(res._status).toBe(400);
  });

  it('returns 500 when git restore fails', async () => {
    spawnMock.mockReturnValue(makeGitChild('error: pathspec not in index', 1));

    const res = makeRes();
    await handleGitRoutes(
      makeReq('POST', { paths: ['src/foo.ts'] }),
      res,
      '/api/git/discard',
    );
    expect(res._status).toBe(500);
    expect(res.json().error).toContain('pathspec not in index');
  });
});
