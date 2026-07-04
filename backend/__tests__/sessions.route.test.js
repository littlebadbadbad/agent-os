/**
 * Tests for backend/routes/sessions.js — Session HTTP routes
 *
 * PURE PROTOCOL LAYER: extracts agentId → calls service → sends result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

const mockService = vi.hoisted(() => ({
  loadAgentSessions: vi.fn(),
  saveAgentSessions: vi.fn(),
}));

vi.mock('../services/sessions.js', () => mockService);

import { handleSessionRoutes } from '../transports/network/sessions.js';

function makeReq(method, body = null) {
  const req = new EventEmitter();
  req.method = method;
  req.url = `/api/agent-sessions/test-agent`;
  process.nextTick(() => {
    if (body !== null) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  const chunks = [];
  return {
    _status: null, _chunks: chunks,
    writeHead(s) { this._status = s; },
    end(c) { if (c) chunks.push(c); },
    setHeader() {},
    json() { return JSON.parse(chunks.join('')); },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/agent-sessions/:agentId', () => {
  it('returns 200 with sessions from service', async () => {
    mockService.loadAgentSessions.mockReturnValue({ sessions: [{ id: 's1' }] });

    const res = makeRes();
    await handleSessionRoutes(makeReq('GET'), res, '/api/agent-sessions/async-agent');

    expect(res._status).toBe(200);
    expect(res.json()).toEqual({ sessions: [{ id: 's1' }] });
    expect(mockService.loadAgentSessions).toHaveBeenCalledWith({ agentId: 'async-agent' });
  });

  it('returns empty sessions when service returns none', async () => {
    mockService.loadAgentSessions.mockReturnValue({ sessions: [] });

    const res = makeRes();
    await handleSessionRoutes(makeReq('GET'), res, '/api/agent-sessions/empty-agent');

    expect(res._status).toBe(200);
    expect(res.json().sessions).toEqual([]);
  });

  it('URL-decodes the agentId', async () => {
    mockService.loadAgentSessions.mockReturnValue({ sessions: [] });

    const res = makeRes();
    await handleSessionRoutes(makeReq('GET'), res, '/api/agent-sessions/async%20agent');

    expect(mockService.loadAgentSessions).toHaveBeenCalledWith({ agentId: 'async agent' });
  });
});

describe('PUT /api/agent-sessions/:agentId', () => {
  it('returns 200 and calls saveAgentSessions with body', async () => {
    mockService.saveAgentSessions.mockReturnValue({ ok: true });
    const sessions = [{ id: 's1', turns: [] }];

    const res = makeRes();
    const req = makeReq('PUT', { sessions });
    req.url = '/api/agent-sessions/async-agent';
    await handleSessionRoutes(req, res, '/api/agent-sessions/async-agent');

    expect(res._status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockService.saveAgentSessions).toHaveBeenCalledWith({
      agentId: 'async-agent', sessions,
    });
  });

  it('passes empty sessions array when body has none', async () => {
    mockService.saveAgentSessions.mockReturnValue({ ok: true });

    const res = makeRes();
    const req = makeReq('PUT', {});
    req.url = '/api/agent-sessions/async-agent';
    await handleSessionRoutes(req, res, '/api/agent-sessions/async-agent');

    expect(mockService.saveAgentSessions).toHaveBeenCalledWith({
      agentId: 'async-agent', sessions: undefined,
    });
  });
});

describe('unmatched routes', () => {
  it('returns false for a non-matching prefix', async () => {
    const result = await handleSessionRoutes(makeReq('GET'), makeRes(), '/api/other');
    expect(result).toBe(false);
  });

  it('returns false for an unsupported method (POST)', async () => {
    const result = await handleSessionRoutes(makeReq('POST'), makeRes(), '/api/agent-sessions/x');
    expect(result).toBe(false);
  });
});
