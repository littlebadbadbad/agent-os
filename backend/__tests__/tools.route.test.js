/**
 * Tests for backend/routes/tools.js  (handleToolRoutes)
 *
 * All store calls are mocked — no real SQLite / file I/O.
 * The logger is silenced so test output stays clean.
 *
 * Covers every route:
 *   GET    /api/tools
 *   POST   /api/tools
 *   DELETE /api/tools/:name
 *   POST   /api/execute-tool
 * Plus: unmatched routes return false.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock store modules ────────────────────────────────────────────────────────

vi.mock('../lib/store.js', () => ({
  listTools:    vi.fn(),
  getTool:      vi.fn(),
  upsertTool:   vi.fn(),
  removeTool:   vi.fn(),
  executeTool:  vi.fn(),
}));

vi.mock('../lib/moduleStore.js', () => ({
  listModules:  vi.fn(),
  getModule:    vi.fn(),
  upsertModule: vi.fn(),
  removeModule: vi.fn(),
}));

vi.mock('../lib/depStore.js', () => ({
  listDeps:    vi.fn(),
  installDeps: vi.fn(),
  removeDep:   vi.fn(),
}));

import { listTools, getTool, upsertTool, removeTool, executeTool } from '../lib/store.js';
import { listModules, getModule, upsertModule, removeModule } from '../lib/moduleStore.js';
import { listDeps, installDeps, removeDep } from '../lib/depStore.js';
import { handleToolRoutes } from '../transports/network/tools.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeReq(method, body = null) {
  const req = new EventEmitter();
  req.method = method;
  process.nextTick(() => {
    if (body !== null) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: null,
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h); },
    end(b) { this._body = b; },
    setHeader(k, v) { this._headers[k] = v; },
    json() { return JSON.parse(this._body); },
  };
  return res;
}

// ── GET /api/tools ────────────────────────────────────────────────────────────

describe('GET /api/tools', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 with the list of tools', async () => {
    listTools.mockReturnValue([
      { name: 'add', description: 'adds numbers', parameters: {}, createdAt: '2024-01-01T00:00:00Z' },
    ]);
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tools');
    expect(res._status).toBe(200);
    expect(res.json().tools).toHaveLength(1);
    expect(res.json().tools[0].name).toBe('add');
  });

  it('returns an empty array when no tools exist', async () => {
    listTools.mockReturnValue([]);
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tools');
    expect(res._status).toBe(200);
    expect(res.json().tools).toEqual([]);
  });

  it('excludes the implementation field from the response', async () => {
    listTools.mockReturnValue([
      { name: 'x', description: 'd', parameters: {}, createdAt: 't', implementation: 'secret code' },
    ]);
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tools');
    expect(res.json().tools[0].implementation).toBeUndefined();
  });
});

// ── POST /api/tools ───────────────────────────────────────────────────────────

describe('POST /api/tools', () => {
  beforeEach(() => vi.resetAllMocks());

  const validBody = {
    name: 'my_tool',
    description: 'does something',
    implementation: 'return args.x * 2;',
    parameters: { type: 'object', properties: {} },
  };

  it('returns 201 and calls upsertTool for a valid body', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', validBody), res, '/api/tools');
    expect(res._status).toBe(201);
    expect(res.json().created).toBe('my_tool');
    expect(upsertTool).toHaveBeenCalledOnce();
    expect(upsertTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'my_tool' }));
  });

  it('uses default empty parameters when not provided', async () => {
    const { parameters: _, ...body } = validBody;
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', body), res, '/api/tools');
    expect(res._status).toBe(201);
    expect(upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { type: 'object', properties: {} } }),
    );
  });

  it('returns 400 when name is missing', async () => {
    const res = makeRes();
    const { name: _, ...body } = validBody;
    await handleToolRoutes(makeReq('POST', body), res, '/api/tools');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/name/);
  });

  it('returns 400 when name is not snake_case', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { ...validBody, name: 'My-Tool' }), res, '/api/tools');
    expect(res._status).toBe(400);
  });

  it('returns 400 when name starts with a digit', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { ...validBody, name: '1bad' }), res, '/api/tools');
    expect(res._status).toBe(400);
  });

  it('returns 400 when description is missing', async () => {
    const res = makeRes();
    const { description: _, ...body } = validBody;
    await handleToolRoutes(makeReq('POST', body), res, '/api/tools');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/description/);
  });

  it('returns 400 when implementation is missing', async () => {
    const res = makeRes();
    const { implementation: _, ...body } = validBody;
    await handleToolRoutes(makeReq('POST', body), res, '/api/tools');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/implementation/);
  });
});

// ── DELETE /api/tools/:name ───────────────────────────────────────────────────

describe('DELETE /api/tools/:name', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 and calls removeTool when the tool exists', async () => {
    removeTool.mockReturnValue(true);
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tools/my_tool');
    expect(res._status).toBe(200);
    expect(res.json().deleted).toBe('my_tool');
    expect(removeTool).toHaveBeenCalledWith('my_tool');
  });

  it('returns 404 when the tool does not exist', async () => {
    removeTool.mockReturnValue(false);
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tools/ghost');
    expect(res._status).toBe(404);
    expect(res.json().error).toMatch(/ghost/);
  });

  it('URL-decodes the tool name in the path', async () => {
    removeTool.mockReturnValue(true);
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tools/my%20tool');
    expect(removeTool).toHaveBeenCalledWith('my tool');
  });
});

// ── POST /api/execute-tool ────────────────────────────────────────────────────

describe('POST /api/execute-tool', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 with the tool result on success', async () => {
    getTool.mockReturnValue({ name: 'add' });
    executeTool.mockResolvedValue(42);
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { name: 'add', arguments: { a: 1 } }), res, '/api/execute-tool');
    expect(res._status).toBe(200);
    expect(res.json().result).toBe(42);
  });

  it('returns 400 when name is missing', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', {}), res, '/api/execute-tool');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/name/);
  });

  it('returns 404 when the named tool does not exist', async () => {
    getTool.mockReturnValue(undefined);
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { name: 'unknown' }), res, '/api/execute-tool');
    expect(res._status).toBe(404);
    expect(res.json().error).toMatch(/unknown/);
  });

  it('returns 422 when executeTool throws', async () => {
    getTool.mockReturnValue({ name: 'bad' });
    executeTool.mockRejectedValue(new Error('division by zero'));
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { name: 'bad', arguments: {} }), res, '/api/execute-tool');
    expect(res._status).toBe(422);
    expect(res.json().error).toMatch(/division by zero/);
  });

  it('defaults arguments to {} when not provided', async () => {
    getTool.mockReturnValue({ name: 'noop' });
    executeTool.mockResolvedValue(null);
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { name: 'noop' }), res, '/api/execute-tool');
    expect(executeTool).toHaveBeenCalledWith('noop', {}, expect.any(Object));
  });
});

// ── Unmatched routes ──────────────────────────────────────────────────────────

describe('unmatched routes', () => {
  it('returns false for an unknown path', async () => {
    const result = await handleToolRoutes(makeReq('GET'), makeRes(), '/api/unknown');
    expect(result).toBe(false);
  });

  it('returns false for a mismatched method', async () => {
    const result = await handleToolRoutes(makeReq('PATCH'), makeRes(), '/api/tools');
    expect(result).toBe(false);
  });
});

// ── GET /api/tool-modules ────────────────────────────────────────────────────

describe('GET /api/tool-modules', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 with the module list', async () => {
    listModules.mockReturnValue([{ name: 'http-client', description: 'HTTP helpers' }]);
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tool-modules');
    expect(res._status).toBe(200);
    expect(res.json().modules).toHaveLength(1);
    expect(res.json().modules[0].name).toBe('http-client');
  });

  it('returns an empty array when no modules exist', async () => {
    listModules.mockReturnValue([]);
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tool-modules');
    expect(res._status).toBe(200);
    expect(res.json().modules).toEqual([]);
  });
});

// ── POST /api/tool-modules ───────────────────────────────────────────────────

describe('POST /api/tool-modules', () => {
  beforeEach(() => vi.resetAllMocks());

  const validBody = {
    name: 'string-utils',
    description: 'String utilities',
    content: 'export function trim(s) { return s.trim(); }',
  };

  it('returns 201 and calls upsertModule for a valid body', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', validBody), res, '/api/tool-modules');
    expect(res._status).toBe(201);
    expect(res.json().created).toBe('string-utils');
    expect(upsertModule).toHaveBeenCalledOnce();
  });

  it('returns 400 for non-kebab-case name', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { ...validBody, name: 'MyModule' }), res, '/api/tool-modules');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/kebab-case/);
  });

  it('returns 400 when name starts with a digit', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { ...validBody, name: '1mod' }), res, '/api/tool-modules');
    expect(res._status).toBe(400);
  });

  it('returns 400 when description is missing', async () => {
    const { description: _, ...body } = validBody;
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', body), res, '/api/tool-modules');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/description/);
  });

  it('returns 400 when content is missing', async () => {
    const { content: _, ...body } = validBody;
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', body), res, '/api/tool-modules');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/content/);
  });

  it('returns 400 when content has no export', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { ...validBody, content: 'function foo() {}' }), res, '/api/tool-modules');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/export/);
  });
});

// ── GET /api/tool-modules/:name ──────────────────────────────────────────────

describe('GET /api/tool-modules/:name', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 with the module when found', async () => {
    getModule.mockReturnValue({ name: 'http-client', description: 'HTTP', content: 'export const x = 1;' });
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tool-modules/http-client');
    expect(res._status).toBe(200);
    expect(res.json().name).toBe('http-client');
  });

  it('returns 404 when the module is not found', async () => {
    getModule.mockReturnValue(undefined);
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tool-modules/ghost');
    expect(res._status).toBe(404);
    expect(res.json().error).toMatch(/ghost/);
  });
});

// ── PATCH /api/tool-modules/:name ────────────────────────────────────────────

describe('PATCH /api/tool-modules/:name', () => {
  beforeEach(() => vi.resetAllMocks());

  const existing = { name: 'http-client', description: 'old', content: 'export const a = 1;' };

  it('returns 200 and calls upsertModule when found', async () => {
    getModule.mockReturnValue(existing);
    const res = makeRes();
    await handleToolRoutes(makeReq('PATCH', { description: 'new' }), res, '/api/tool-modules/http-client');
    expect(res._status).toBe(200);
    expect(upsertModule).toHaveBeenCalledWith(expect.objectContaining({ name: 'http-client', description: 'new' }));
  });

  it('returns 404 when module does not exist', async () => {
    getModule.mockReturnValue(undefined);
    const res = makeRes();
    await handleToolRoutes(makeReq('PATCH', { description: 'x' }), res, '/api/tool-modules/ghost');
    expect(res._status).toBe(404);
  });

  it('returns 400 when no fields are provided', async () => {
    getModule.mockReturnValue(existing);
    const res = makeRes();
    await handleToolRoutes(makeReq('PATCH', {}), res, '/api/tool-modules/http-client');
    expect(res._status).toBe(400);
  });

  it('returns 400 when updated content has no export', async () => {
    getModule.mockReturnValue(existing);
    const res = makeRes();
    await handleToolRoutes(makeReq('PATCH', { content: 'function foo() {}' }), res, '/api/tool-modules/http-client');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/export/);
  });
});

// ── DELETE /api/tool-modules/:name ───────────────────────────────────────────

describe('DELETE /api/tool-modules/:name', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 when the module exists and is deleted', async () => {
    getModule.mockReturnValue({ name: 'http-client', content: 'export const x = 1;' });
    removeModule.mockReturnValue(true);
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tool-modules/http-client');
    expect(res._status).toBe(200);
    expect(res.json().deleted).toBe('http-client');
    expect(removeModule).toHaveBeenCalledWith('http-client');
  });

  it('returns 404 when the module does not exist', async () => {
    removeModule.mockReturnValue(false);
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tool-modules/ghost');
    expect(res._status).toBe(404);
  });
});

// ── GET /api/tool-deps ───────────────────────────────────────────────────────

describe('GET /api/tool-deps', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 with dependency info', async () => {
    listDeps.mockReturnValue({ dependencies: { axios: '1.0.0' }, devDependencies: {} });
    const res = makeRes();
    await handleToolRoutes(makeReq('GET'), res, '/api/tool-deps');
    expect(res._status).toBe(200);
    expect(res.json().dependencies).toEqual({ axios: '1.0.0' });
  });
});

// ── POST /api/tool-deps/install ──────────────────────────────────────────────

describe('POST /api/tool-deps/install', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 on successful install', async () => {
    installDeps.mockResolvedValue({ success: true, packages: ['axios'], output: 'ok' });
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { packages: ['axios'] }), res, '/api/tool-deps/install');
    expect(res._status).toBe(200);
    expect(res.json().success).toBe(true);
    expect(installDeps).toHaveBeenCalledWith(['axios']);
  });

  it('returns 422 when pnpm fails', async () => {
    installDeps.mockResolvedValue({ success: false, packages: ['bad-pkg'], output: 'error log' });
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { packages: ['bad-pkg'] }), res, '/api/tool-deps/install');
    expect(res._status).toBe(422);
    expect(res.json().success).toBe(false);
  });

  it('returns 400 when packages is not an array', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { packages: 'axios' }), res, '/api/tool-deps/install');
    expect(res._status).toBe(400);
  });

  it('returns 400 when packages array is empty', async () => {
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { packages: [] }), res, '/api/tool-deps/install');
    expect(res._status).toBe(400);
  });

  it('returns 400 when installDeps throws a validation error', async () => {
    installDeps.mockRejectedValue(new Error('Invalid package name(s): rm -rf /'));
    const res = makeRes();
    await handleToolRoutes(makeReq('POST', { packages: ['rm -rf /'] }), res, '/api/tool-deps/install');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/Invalid package name/);
  });
});

// ── DELETE /api/tool-deps/:pkg ───────────────────────────────────────────────

describe('DELETE /api/tool-deps/:pkg', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 on successful removal', async () => {
    removeDep.mockResolvedValue({ success: true, output: 'removed' });
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tool-deps/axios');
    expect(res._status).toBe(200);
    expect(res.json().success).toBe(true);
    expect(removeDep).toHaveBeenCalledWith('axios');
  });

  it('returns 422 when removal fails', async () => {
    removeDep.mockResolvedValue({ success: false, output: 'not found' });
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tool-deps/ghost');
    expect(res._status).toBe(422);
  });

  it('returns 400 when removeDep throws a validation error', async () => {
    removeDep.mockRejectedValue(new Error('Invalid package name(s): ../../etc/passwd'));
    const res = makeRes();
    await handleToolRoutes(makeReq('DELETE'), res, '/api/tool-deps/..%2F..%2Fetc%2Fpasswd');
    expect(res._status).toBe(400);
  });
});
