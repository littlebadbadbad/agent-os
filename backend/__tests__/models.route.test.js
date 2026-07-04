/**
 * Tests for backend/routes/models.js — Model listing HTTP route
 *
 * Pure protocol layer: parses provider from query → calls models service
 * → sends JSON response.  The models service is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

const mockListModels = vi.hoisted(() => vi.fn());
vi.mock('../services/models.js', () => ({
  listModels: (...a) => mockListModels(...a),
}));

import { handleModelRoutes } from '../transports/network/models.js';

function makeReq(url) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = url;
  process.nextTick(() => req.emit('end'));
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

describe('GET /api/models', () => {
  const MODELS = [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', url: 'https://api.example.com/v1', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 }];

  it('returns 200 with models for a valid provider', async () => {
    mockListModels.mockResolvedValue({ provider: 'DeepSeek', models: MODELS });

    const res = makeRes();
    await handleModelRoutes(makeReq('/api/models?provider=DeepSeek'), res, '/api/models');

    expect(res._status).toBe(200);
    expect(res.json()).toEqual({ provider: 'DeepSeek', models: MODELS });
    expect(mockListModels).toHaveBeenCalledWith('DeepSeek');
  });

  it('returns 400 when provider param is missing', async () => {
    mockListModels.mockRejectedValue(new Error('Missing required param: provider'));

    const res = makeRes();
    await handleModelRoutes(makeReq('/api/models'), res, '/api/models');

    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/provider/);
  });

  it('returns 400 for an unknown provider', async () => {
    mockListModels.mockRejectedValue(new Error('Unknown provider "unknown". Available: DeepSeek, GLM'));

    const res = makeRes();
    await handleModelRoutes(makeReq('/api/models?provider=unknown'), res, '/api/models');

    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/unknown/i);
  });

  it('returns 502 when the provider rejects', async () => {
    mockListModels.mockRejectedValue(new Error('upstream timeout'));

    const res = makeRes();
    await handleModelRoutes(makeReq('/api/models?provider=DeepSeek'), res, '/api/models');

    expect(res._status).toBe(502);
    expect(res.json().error).toMatch(/upstream timeout/);
  });

  it('returns false for a non-GET method', async () => {
    const req = makeReq('/api/models');
    req.method = 'POST';
    const result = await handleModelRoutes(req, makeRes(), '/api/models');
    expect(result).toBe(false);
  });

  it('returns false for a non-matching path', async () => {
    const result = await handleModelRoutes(makeReq('/api/other'), makeRes(), '/api/other');
    expect(result).toBe(false);
  });
});
