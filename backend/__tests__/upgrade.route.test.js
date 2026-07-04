/**
 * Tests for backend/routes/upgrade.js  (handleUpgradeRoutes)
 *
 * Every test fresh-imports the module via vi.resetModules() so module-level
 * state (devServerTerminalId, buildInFlight, ...) is reset between cases.
 *
 * All operations (build, test, dev server) run through the terminal manager.
 * Tests drive them via makeShellMgr() -- a fully controllable fake that
 * replaces the real node-pty-backed shell-manager.
 *
 * Covered:
 *   getVersion()                -- dev mode and pkg mode
 *   POST /api/upgrade/build     -- new terminal, existing terminal, concurrent lock, pkg cv path
 *   POST /api/upgrade/restart   -- dev mode 409, pkg mode exit timer
 *   POST /api/upgrade/dev/start -- URL detection, alreadyRunning, exit-before-ready, timeout
 *   POST /api/upgrade/dev/stop  -- stopped=false, stopped=true
 *   GET  /api/upgrade/dev/status -- running=false, running=true with terminalId
 *   POST /api/upgrade/test      -- both targets, extra args, errors, existing terminal
 *   unmatched path              -- returns false
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

// -- Stable module-level mock -------------------------------------------------

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// -- Fake shell-manager factory -----------------------------------------------

/**
 * Creates a fully controllable fake shell-manager.
 *
 * @param {object} [opts]
 * @param {(id: string, term: object, opts: object) => void} [opts.onCreateTerminal]
 *   Called synchronously inside createTerminal.  Schedule output/exit via
 *   process.nextTick — nextTick runs before setTimeout(0), so the buffer is
 *   populated before the first poll() fires.
 * @param {(id: string, text: string) => void} [opts.onWrite]
 *   Override writeToTerminal behaviour.  When omitted, the factory auto-detects
 *   sentinel echo lines and emits the sentinel back with exit-code 0 on the
 *   next tick so _runInExisting() resolves automatically.
 */
function makeShellMgr({ onCreateTerminal, onWrite } = {}) {
  const _terms = new Map();
  const _bufs  = new Map();   // accumulated output per terminal (for term.read())
  const _subs  = new Map();

  const _emit = (id, text) => {
    // Append to buffer so term.read() can find it.
    _bufs.set(id, (_bufs.get(id) ?? '') + text);
    const s = _subs.get(id);
    if (s) for (const fn of [...s]) fn({ text, done: false });
  };

  const _exit = (id, exitCode = 0) => {
    const term = _terms.get(id);
    if (term) { term._alive = false; term._exitCode = exitCode; }
    const s = _subs.get(id);
    if (s) {
      for (const fn of [...s]) fn({ text: '', done: true, exitCode });
      s.clear();
    }
  };

  const createTerminal = vi.fn((opts = {}) => {
    const id = 'term_' + (_terms.size + 1);
    _bufs.set(id, '');
    const term = {
      id,
      _alive: true,
      _exitCode: undefined,
      get running() { return this._alive; },
      write: vi.fn(),
      kill: vi.fn(() => { term._alive = false; }),
      // Mirrors TerminalInstance.read(fromOffset) — used by the polling loop
      // in startDevServer() and _runInExisting().
      read: vi.fn((fromOffset = 0) => {
        const buf = _bufs.get(id) ?? '';
        return {
          output:   buf.slice(fromOffset),
          offset:   buf.length,
          running:  term._alive,
          exitCode: term._exitCode,
        };
      }),
    };
    _terms.set(id, term);
    _subs.set(id, new Set());
    if (onCreateTerminal) onCreateTerminal(id, term, opts);
    return term;
  });

  const getTerminal = vi.fn(id => _terms.get(id) ?? null);

  const removeTerminal = vi.fn(id => {
    const term = _terms.get(id);
    if (!term) return false;
    _exit(id, 0);
    _terms.delete(id);
    _subs.delete(id);
    return true;
  });

  const streamTerminalOutput = vi.fn((id, onData) => {
    if (!_subs.has(id)) _subs.set(id, new Set());
    _subs.get(id).add(onData);
    return () => _subs.get(id)?.delete(onData);
  });

  const writeToTerminal = vi.fn((id, text) => {
    if (onWrite) {
      onWrite(id, text);
    } else {
      // Auto-sentinel: detect "echo __UPGRD_xxxx__:..." and emit back with code 0.
      const m = text.match(/__UPGRD_([a-f0-9]+)__/);
      if (m) {
        const sentinel = '__UPGRD_' + m[1] + '__';
        process.nextTick(() => _emit(id, sentinel + ':0\n'));
      }
    }
  });

  return {
    mock: {
      createTerminal, getTerminal, removeTerminal, streamTerminalOutput, writeToTerminal,
      listAvailableShells: vi.fn(() => []),
      listTerminalEntries: vi.fn(() => []),
      resizeTerminal: vi.fn(),
    },
    emit: _emit,
    exit: _exit,
    lastId: () => [..._terms.keys()].at(-1) ?? null,
  };
}

// -- Test helpers -------------------------------------------------------------

function makeRes() {
  return {
    _status: null, _headers: {}, _body: null,
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h); },
    end(b) { this._body = b; },
    setHeader(k, v) { this._headers[k] = v; },
    json() { return JSON.parse(this._body); },
  };
}

function makeReq(method, body = null) {
  const req = new EventEmitter();
  req.method = method;
  req.url = '';
  process.nextTick(() => {
    if (body !== null) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

async function loadModule(opts = {}) {
  const {
    isPkg       = false,
    projectRoot = '/fake/project',
    exeDir      = '/fake/project',
    shellMgr    = makeShellMgr().mock,
    existsImpl  = vi.fn().mockReturnValue(false),
    readImpl    = vi.fn(),
  } = opts;

  vi.resetModules();
  if (isPkg) process.pkg = {};
  else delete process.pkg;

  vi.doMock('fs', () => ({ existsSync: existsImpl, readFileSync: readImpl }));
  vi.doMock('../lib/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }));
  vi.doMock('../lib/paths.js', () => ({ IS_PKG: isPkg, EXE_DIR: exeDir, PROJECT_ROOT: projectRoot }));
  vi.doMock('../lib/shell-manager/index.js', () => shellMgr);

  const mod = await import('../transports/network/upgrade.js');
  return { handleUpgradeRoutes: mod.handleUpgradeRoutes, existsImpl, readImpl };
}

afterEach(() => {
  delete process.pkg;
  vi.useRealTimers();
});

// =============================================================================
// Unmatched paths
// =============================================================================

describe('handleUpgradeRoutes -- unmatched path', () => {
  it('returns false for a non-upgrade path', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    expect(await handleUpgradeRoutes(makeReq('GET'), makeRes(), '/api/chat')).toBe(false);
  });

  it('returns false for /api/upgrade (missing trailing slash + subpath)', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    expect(await handleUpgradeRoutes(makeReq('GET'), makeRes(), '/api/upgrade')).toBe(false);
  });
});

// =============================================================================
// GET /api/upgrade/version
// =============================================================================

describe('GET /api/upgrade/version -- dev mode', () => {
  it('returns version from package.json', async () => {
    const { handleUpgradeRoutes, existsImpl, readImpl } = await loadModule();
    existsImpl.mockReturnValue(true);
    readImpl.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/version');
    expect(res._status).toBe(200);
    expect(res.json().version).toBe('1.2.3');
  });

  it('returns "unknown" when package.json does not exist', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/version');
    expect(res.json().version).toBe('unknown');
  });

  it('returns "unknown" when package.json has no version field', async () => {
    const { handleUpgradeRoutes, existsImpl, readImpl } = await loadModule();
    existsImpl.mockReturnValue(true);
    readImpl.mockReturnValue(JSON.stringify({ name: 'myapp' }));
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/version');
    expect(res.json().version).toBe('unknown');
  });

  it('returns "unknown" when package.json contains invalid JSON', async () => {
    const { handleUpgradeRoutes, existsImpl, readImpl } = await loadModule();
    existsImpl.mockReturnValue(true);
    readImpl.mockReturnValue('not-json');
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/version');
    expect(res.json().version).toBe('unknown');
  });
});

describe('GET /api/upgrade/version -- pkg mode', () => {
  it('returns basename of EXE_DIR', async () => {
    const { handleUpgradeRoutes } = await loadModule({
      isPkg: true, exeDir: '/release/v0.1.0-20260525-064242',
    });
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/version');
    expect(res._status).toBe(200);
    expect(res.json().version).toBe('v0.1.0-20260525-064242');
  });
});

// =============================================================================
// POST /api/upgrade/build
// =============================================================================

describe('POST /api/upgrade/build', () => {
  it('creates a new terminal and returns { started, terminalId } immediately', async () => {
    const shm = makeShellMgr({
      // Terminal exits on next tick — route must have already responded before this.
      onCreateTerminal: (id) => process.nextTick(() => shm.exit(id, 0)),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/build');

    expect(res._status).toBe(200);
    expect(res.json().started).toBe(true);
    expect(res.json().terminalId).toBeTruthy();
    expect(shm.mock.createTerminal).toHaveBeenCalledOnce();
  });

  it('releases buildInFlight lock after the terminal exits', async () => {
    let exitCallback;
    const shm = makeShellMgr({
      onCreateTerminal: (id) => {
        // Capture the term so we can exit it manually later.
        exitCallback = () => shm.exit(id, 0);
      },
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    // First build starts and returns.
    await handleUpgradeRoutes(makeReq('POST'), makeRes(), '/api/upgrade/build');

    // Lock is held — second request should be rejected.
    const res2 = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res2, '/api/upgrade/build');
    expect(res2._status).toBe(409);

    // Terminal exits → lock released.
    exitCallback();
    await new Promise(r => process.nextTick(r));

    // Third request should now succeed.
    const res3 = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res3, '/api/upgrade/build');
    expect(res3._status).toBe(200);
    expect(res3.json().started).toBe(true);
  });

  it('returns 409 when a build is already in progress', async () => {
    const shm = makeShellMgr(); // terminal never exits → lock held indefinitely
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    await handleUpgradeRoutes(makeReq('POST'), makeRes(), '/api/upgrade/build');

    const res2 = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res2, '/api/upgrade/build');
    expect(res2._status).toBe(409);
    expect(res2.json().error).toMatch(/already in progress/i);
  });

  it('runs command in existing terminal when terminalId is provided', async () => {
    const shm = makeShellMgr(); // auto-sentinel auto-responds so lock can be released
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const existingTerm = shm.mock.createTerminal({ label: 'Existing' });

    const res = makeRes();
    await handleUpgradeRoutes(
      makeReq('POST', { terminalId: existingTerm.id }), res, '/api/upgrade/build',
    );

    expect(res._status).toBe(200);
    expect(res.json().started).toBe(true);
    expect(res.json().terminalId).toBe(existingTerm.id);
    expect(shm.mock.writeToTerminal).toHaveBeenCalledWith(
      existingTerm.id, expect.stringContaining('pnpm build:exe'),
    );
  });

  it('releases buildInFlight via sentinel when using existing terminal', async () => {
    const shm = makeShellMgr(); // auto-sentinel fires on next tick
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const existingTerm = shm.mock.createTerminal({ label: 'Existing' });
    await handleUpgradeRoutes(
      makeReq('POST', { terminalId: existingTerm.id }), makeRes(), '/api/upgrade/build',
    );

    // Give next-tick callbacks time to run.
    await new Promise(r => setTimeout(r, 10));

    // Lock should now be released — new build accepted.
    const res2 = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res2, '/api/upgrade/build');
    expect(res2._status).toBe(200);
    expect(res2.json().started).toBe(true);
  });

  it('returns 500 when the specified terminalId does not exist', async () => {
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });
    const res = makeRes();
    await handleUpgradeRoutes(
      makeReq('POST', { terminalId: 'nonexistent-id' }), res, '/api/upgrade/build',
    );
    expect(res._status).toBe(500);
    expect(res.json().error).toMatch(/not available/i);
  });
});

// =============================================================================
// POST /api/upgrade/restart
// =============================================================================

describe('POST /api/upgrade/restart -- dev mode (IS_PKG=false)', () => {
  it('returns 409 in dev mode', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/restart');
    expect(res._status).toBe(409);
    expect(res.json().error).toMatch(/packaged executable/i);
  });
});

describe('POST /api/upgrade/restart -- pkg mode (IS_PKG=true)', () => {
  it('returns 200 and calls process.exit(75) after 1 second', async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

    const { handleUpgradeRoutes } = await loadModule({ isPkg: true });
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/restart');

    expect(res._status).toBe(200);
    expect(res.json().status).toBe('restarting');
    expect(exitSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1100);
    expect(exitSpy).toHaveBeenCalledWith(75);
    exitSpy.mockRestore();
  });
});

// =============================================================================
// POST /api/upgrade/dev/start
// =============================================================================

describe('POST /api/upgrade/dev/start', () => {
  it('starts the dev server and returns URL + terminalId', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (id) =>
        process.nextTick(() => shm.emit(id, '  => Local:   http://localhost:5173/\n')),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/start');

    expect(res._status).toBe(200);
    expect(res.json().url).toBe('http://localhost:5173');
    expect(res.json().alreadyRunning).toBe(false);
    expect(res.json().terminalId).toBeTruthy();
  });

  it('strips trailing slash from URL', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (id) =>
        process.nextTick(() => shm.emit(id, '  Local:   http://localhost:5173/\n')),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/start');
    expect(res.json().url).toBe('http://localhost:5173');
  });

  it('returns alreadyRunning=true on second start (server still alive)', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (id) =>
        process.nextTick(() => shm.emit(id, '  => Local:   http://localhost:5173/\n')),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const res1 = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res1, '/api/upgrade/dev/start');
    expect(res1.json().alreadyRunning).toBe(false);

    const res2 = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res2, '/api/upgrade/dev/start');
    expect(res2.json().alreadyRunning).toBe(true);
    expect(res2.json().url).toBe('http://localhost:5173');
    expect(shm.mock.createTerminal).toHaveBeenCalledOnce();
  });

  it('returns 500 when terminal exits before printing URL', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (id) => process.nextTick(() => shm.exit(id, 1)),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/start');
    expect(res._status).toBe(500);
    expect(res.json().error).toMatch(/exited before becoming ready/);
  });

  it('returns 500 when term.write throws', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (_id, term) => {
        term.write.mockImplementation(() => { throw new Error('PTY write failed'); });
      },
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/start');
    expect(res._status).toBe(500);
    expect(res.json().error).toContain('PTY write failed');
  });

  it('returns 500 with timeout error when URL not emitted within 30 s', async () => {
    vi.useFakeTimers();
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const res = makeRes();
    const routePromise = handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/start');
    vi.advanceTimersByTime(30_001);
    await routePromise;

    expect(res._status).toBe(500);
    expect(res.json().error).toMatch(/did not print a URL within 30 s/);
  });
});

// =============================================================================
// POST /api/upgrade/dev/stop
// =============================================================================

describe('POST /api/upgrade/dev/stop', () => {
  it('returns stopped=false when server is not running', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/stop');
    expect(res._status).toBe(200);
    expect(res.json().stopped).toBe(false);
    expect(res.json().reason).toBe('not running');
  });

  it('calls removeTerminal and returns stopped=true when server is running', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (id) =>
        process.nextTick(() => shm.emit(id, '  => Local:   http://localhost:5173/\n')),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    await handleUpgradeRoutes(makeReq('POST'), makeRes(), '/api/upgrade/dev/start');
    const termId = shm.lastId();

    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST'), res, '/api/upgrade/dev/stop');
    expect(res._status).toBe(200);
    expect(res.json().stopped).toBe(true);
    expect(shm.mock.removeTerminal).toHaveBeenCalledWith(termId);
  });
});

// =============================================================================
// GET /api/upgrade/dev/status
// =============================================================================

describe('GET /api/upgrade/dev/status', () => {
  it('returns running=false when not started', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/dev/status');
    expect(res._status).toBe(200);
    expect(res.json().running).toBe(false);
    expect(res.json().url).toBeUndefined();
    expect(res.json().terminalId).toBeUndefined();
  });

  it('returns running=true with url and terminalId when server is running', async () => {
    const shm = makeShellMgr({
      onCreateTerminal: (id) =>
        process.nextTick(() => shm.emit(id, '  => Local:   http://localhost:5173/\n')),
    });
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    await handleUpgradeRoutes(makeReq('POST'), makeRes(), '/api/upgrade/dev/start');

    const res = makeRes();
    await handleUpgradeRoutes(makeReq('GET'), res, '/api/upgrade/dev/status');
    expect(res.json().running).toBe(true);
    expect(res.json().url).toBe('http://localhost:5173');
    expect(res.json().terminalId).toBeTruthy();
  });
});

// =============================================================================
// POST /api/upgrade/test
// =============================================================================

describe('POST /api/upgrade/test', () => {
  it('starts tests and returns terminalId immediately', async () => {
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST', { target: 'backend' }), res, '/api/upgrade/test');

    expect(res._status).toBe(200);
    expect(res.json().started).toBe(true);
    expect(res.json().terminalId).toBeTruthy();
    expect(shm.mock.writeToTerminal).toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('vitest.config.ts'),
    );
  });

  it('uses vitest.sdk.config.ts for sdk target', async () => {
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    await handleUpgradeRoutes(makeReq('POST', { target: 'sdk' }), makeRes(), '/api/upgrade/test');
    expect(shm.mock.writeToTerminal).toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('vitest.sdk.config.ts'),
    );
  });

  it('forwards extra args into the shell command string', async () => {
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    await handleUpgradeRoutes(
      makeReq('POST', { target: 'backend', args: ['--coverage', 'chat'] }),
      makeRes(), '/api/upgrade/test',
    );
    expect(shm.mock.writeToTerminal).toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('--coverage'),
    );
    expect(shm.mock.writeToTerminal).toHaveBeenCalledWith(
      expect.any(String), expect.stringContaining('chat'),
    );
  });

  it('returns 400 for unknown target', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(makeReq('POST', { target: 'unknown' }), res, '/api/upgrade/test');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/backend.*sdk/i);
  });

  it('returns 400 when args contains a non-string', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(
      makeReq('POST', { target: 'backend', args: ['ok', 42] }), res, '/api/upgrade/test',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/args/i);
  });

  it('returns 400 when args is not an array', async () => {
    const { handleUpgradeRoutes } = await loadModule();
    const res = makeRes();
    await handleUpgradeRoutes(
      makeReq('POST', { target: 'backend', args: 'not-an-array' }), res, '/api/upgrade/test',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/args/i);
  });

  it('returns 409 when a test is already in flight', async () => {
    vi.useFakeTimers();
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    await handleUpgradeRoutes(makeReq('POST', { target: 'backend' }), makeRes(), '/api/upgrade/test');
    // Second request while first is still in flight → 409
    const res2 = makeRes();
    await handleUpgradeRoutes(makeReq('POST', { target: 'backend' }), res2, '/api/upgrade/test');
    expect(res2._status).toBe(409);
    expect(res2.json().error).toMatch(/already in progress/i);
    vi.useRealTimers();
  });

  it('runs command in existing terminal when terminalId is provided', async () => {
    const shm = makeShellMgr();
    const { handleUpgradeRoutes } = await loadModule({ shellMgr: shm.mock });

    const existingTerm = shm.mock.createTerminal({ label: 'Existing' });

    const res = makeRes();
    await handleUpgradeRoutes(
      makeReq('POST', { target: 'backend', terminalId: existingTerm.id }),
      res, '/api/upgrade/test',
    );
    expect(res.json().started).toBe(true);
    expect(res.json().terminalId).toBe(existingTerm.id);
    expect(shm.mock.writeToTerminal).toHaveBeenCalledWith(
      existingTerm.id, expect.stringContaining('vitest.config.ts'),
    );
  });
});
