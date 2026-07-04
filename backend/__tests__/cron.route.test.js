/**
 * Tests for backend/routes/cron.js  (handleCronRoutes)
 *
 * All cron-manager functions are mocked — no real scheduler or timer.
 * The logger is silenced.
 *
 * Covers every route:
 *   GET    /api/cron/stream?sessionId=X  — SSE stream (headers, retry, fired
 *                                          event, heartbeat, close cleanup)
 *   GET    /api/cron?sessionId=X         — list jobs
 *   POST   /api/cron                     — create job (validation + success)
 *   POST   /api/cron/:id/pause           — pause
 *   POST   /api/cron/:id/resume          — resume
 *   DELETE /api/cron/:id                 — delete
 *   GET    /api/cron/:id                 — get single job
 * Plus: unmatched paths return false.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock cron-manager ─────────────────────────────────────────────────────────

vi.mock('../lib/cron-manager/index.js', () => ({
  createJob:    vi.fn(),
  deleteJob:    vi.fn(),
  pauseJob:     vi.fn(),
  resumeJob:    vi.fn(),
  listJobs:     vi.fn(),
  getJob:       vi.fn(),
  subscribe:    vi.fn(),
  serializeJob: vi.fn(x => x),   // identity – tests inspect raw job fields
}));

import {
  createJob, deleteJob, pauseJob, resumeJob,
  listJobs, getJob, subscribe,
} from '../lib/cron-manager/index.js';
import { handleCronRoutes } from '../transports/network/cron.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeReq(method, url, body = null) {
  const req = new EventEmitter();
  req.method = method;
  req.url    = url;
  process.nextTick(() => {
    if (body !== null) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  const res = {
    _status:  null,
    _headers: {},
    _body:    null,
    _written: [],
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h); },
    end(b)               { this._body = b; },
    write(chunk)         { this._written.push(chunk); },
    setHeader(k, v)      { this._headers[k] = v; },
    json()               { return JSON.parse(this._body); },
  };
  return res;
}

const SAMPLE_JOB = {
  id: 'cron_abc123',
  sessionId: 'sess1',
  label: 'Test job',
  cronExpr: '0 9 * * *',
  prompt: 'Run daily report',
  recurring: true,
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  lastFiredAt: null,
  nextFireAt: '2024-01-02T09:00:00.000Z',
  fireCount: 0,
};

beforeEach(() => vi.clearAllMocks());

// ─── GET /api/cron/stream ─────────────────────────────────────────────────────

describe('GET /api/cron/stream', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = makeRes();
    await handleCronRoutes(makeReq('GET', '/api/cron/stream'), res, '/api/cron/stream');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/sessionId/);
  });

  it('sets SSE headers and sends retry for a valid sessionId', async () => {
    subscribe.mockReturnValue(vi.fn()); // unsubscribe fn
    const req = makeReq('GET', '/api/cron/stream?sessionId=sess1');
    const res = makeRes();

    await handleCronRoutes(req, res, '/api/cron/stream');

    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
    expect(res._headers['Cache-Control']).toBe('no-cache');
    expect(res._headers['Connection']).toBe('keep-alive');
    expect(res._written[0]).toBe('retry: 1500\n\n');
  });

  it('calls subscribe with the correct sessionId', async () => {
    subscribe.mockReturnValue(vi.fn());
    const req = makeReq('GET', '/api/cron/stream?sessionId=sess99');
    const res = makeRes();
    await handleCronRoutes(req, res, '/api/cron/stream');
    expect(subscribe).toHaveBeenCalledWith('sess99', expect.any(Function));
  });

  it('writes a fired event when the subscribe callback is invoked', async () => {
    let capturedCb;
    subscribe.mockImplementation((_sid, fn) => { capturedCb = fn; return vi.fn(); });
    const req = makeReq('GET', '/api/cron/stream?sessionId=sess1');
    const res = makeRes();
    await handleCronRoutes(req, res, '/api/cron/stream');

    capturedCb('cron_abc123', 'Run the report');
    expect(res._written).toContain(
      'event: fired\ndata: {"jobId":"cron_abc123","prompt":"Run the report"}\n\n',
    );
  });

  it('cleans up heartbeat and unsubscribes on req close', async () => {
    vi.useFakeTimers();
    const unsubMock = vi.fn();
    subscribe.mockReturnValue(unsubMock);

    const req = makeReq('GET', '/api/cron/stream?sessionId=close-test');
    const res = makeRes();
    await handleCronRoutes(req, res, '/api/cron/stream');

    req.emit('close');
    expect(unsubMock).toHaveBeenCalledOnce();

    // Advancing past the heartbeat interval should NOT write anything
    const writtenBefore = res._written.length;
    vi.advanceTimersByTime(35_000);
    expect(res._written.length).toBe(writtenBefore);

    vi.useRealTimers();
  });

  it('sends a heartbeat after 30 s', async () => {
    vi.useFakeTimers();
    subscribe.mockReturnValue(vi.fn());

    const req = makeReq('GET', '/api/cron/stream?sessionId=hb-test');
    const res = makeRes();
    await handleCronRoutes(req, res, '/api/cron/stream');

    vi.advanceTimersByTime(30_000);
    expect(res._written).toContain('event: heartbeat\ndata: {}\n\n');

    req.emit('close'); // cleanup
    vi.useRealTimers();
  });
});

// ─── GET /api/cron ────────────────────────────────────────────────────────────

describe('GET /api/cron', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = makeRes();
    await handleCronRoutes(makeReq('GET', '/api/cron'), res, '/api/cron');
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/sessionId/);
  });

  it('returns 200 with the jobs array', async () => {
    listJobs.mockReturnValue([SAMPLE_JOB]);
    const res = makeRes();
    await handleCronRoutes(makeReq('GET', '/api/cron?sessionId=sess1'), res, '/api/cron');
    expect(res._status).toBe(200);
    expect(res.json().jobs).toHaveLength(1);
    expect(res.json().jobs[0].id).toBe('cron_abc123');
  });

  it('returns an empty jobs array when none exist', async () => {
    listJobs.mockReturnValue([]);
    const res = makeRes();
    await handleCronRoutes(makeReq('GET', '/api/cron?sessionId=sess1'), res, '/api/cron');
    expect(res._status).toBe(200);
    expect(res.json().jobs).toHaveLength(0);
  });
});

// ─── POST /api/cron ───────────────────────────────────────────────────────────

describe('POST /api/cron', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron', { cronExpr: '0 9 * * *', prompt: 'x' }),
      res, '/api/cron',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/sessionId/);
  });

  it('returns 400 when cronExpr is missing', async () => {
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron', { sessionId: 's1', prompt: 'x' }),
      res, '/api/cron',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/cronExpr/);
  });

  it('returns 400 when prompt is missing', async () => {
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron', { sessionId: 's1', cronExpr: '0 9 * * *' }),
      res, '/api/cron',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/prompt/);
  });

  it('returns 400 when createJob throws (invalid expression)', async () => {
    createJob.mockImplementation(() => { throw new Error('Invalid cron expression: "bad"'); });
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron', { sessionId: 's1', cronExpr: 'bad', prompt: 'x' }),
      res, '/api/cron',
    );
    expect(res._status).toBe(400);
    expect(res.json().error).toMatch(/invalid cron expression/i);
  });

  it('returns 201 with the created job on success', async () => {
    createJob.mockReturnValue(SAMPLE_JOB);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron', {
        sessionId: 'sess1', cronExpr: '0 9 * * *', prompt: 'Run daily report',
      }),
      res, '/api/cron',
    );
    expect(res._status).toBe(201);
    expect(res.json().id).toBe('cron_abc123');
  });

  it('passes recurring and label through to createJob', async () => {
    createJob.mockReturnValue(SAMPLE_JOB);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron', {
        sessionId: 'sess1', cronExpr: '0 9 * * *',
        prompt: 'p', recurring: false, label: 'My label',
      }),
      res, '/api/cron',
    );
    expect(createJob).toHaveBeenCalledWith({
      sessionId: 'sess1', cronExpr: '0 9 * * *',
      prompt: 'p', recurring: false, label: 'My label',
    });
  });
});

// ─── POST /api/cron/:id/pause ─────────────────────────────────────────────────

describe('POST /api/cron/:id/pause', () => {
  it('returns 404 when the job is not found', async () => {
    pauseJob.mockReturnValue(null);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron/missing/pause'),
      res, '/api/cron/missing/pause',
    );
    expect(res._status).toBe(404);
  });

  it('returns 200 with the paused job', async () => {
    const paused = { ...SAMPLE_JOB, status: 'paused', nextFireAt: null };
    pauseJob.mockReturnValue(paused);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron/cron_abc123/pause'),
      res, '/api/cron/cron_abc123/pause',
    );
    expect(res._status).toBe(200);
    expect(res.json().status).toBe('paused');
  });
});

// ─── POST /api/cron/:id/resume ────────────────────────────────────────────────

describe('POST /api/cron/:id/resume', () => {
  it('returns 404 when the job is not found or is completed', async () => {
    resumeJob.mockReturnValue(null);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron/missing/resume'),
      res, '/api/cron/missing/resume',
    );
    expect(res._status).toBe(404);
  });

  it('returns 200 with the resumed job', async () => {
    resumeJob.mockReturnValue(SAMPLE_JOB);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('POST', '/api/cron/cron_abc123/resume'),
      res, '/api/cron/cron_abc123/resume',
    );
    expect(res._status).toBe(200);
    expect(res.json().status).toBe('active');
  });
});

// ─── DELETE /api/cron/:id ─────────────────────────────────────────────────────

describe('DELETE /api/cron/:id', () => {
  it('returns 404 when the job is not found', async () => {
    deleteJob.mockReturnValue(false);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('DELETE', '/api/cron/missing'),
      res, '/api/cron/missing',
    );
    expect(res._status).toBe(404);
  });

  it('returns 200 with success: true', async () => {
    deleteJob.mockReturnValue(true);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('DELETE', '/api/cron/cron_abc123'),
      res, '/api/cron/cron_abc123',
    );
    expect(res._status).toBe(200);
    expect(res.json().success).toBe(true);
  });
});

// ─── GET /api/cron/:id ────────────────────────────────────────────────────────

describe('GET /api/cron/:id', () => {
  it('returns 404 when the job is not found', async () => {
    getJob.mockReturnValue(undefined);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('GET', '/api/cron/missing'),
      res, '/api/cron/missing',
    );
    expect(res._status).toBe(404);
  });

  it('returns 200 with the job', async () => {
    getJob.mockReturnValue(SAMPLE_JOB);
    const res = makeRes();
    await handleCronRoutes(
      makeReq('GET', '/api/cron/cron_abc123'),
      res, '/api/cron/cron_abc123',
    );
    expect(res._status).toBe(200);
    expect(res.json().id).toBe('cron_abc123');
  });
});

// ─── Unmatched paths ──────────────────────────────────────────────────────────

describe('unmatched paths', () => {
  it('returns false for an unrecognised path', async () => {
    const result = await handleCronRoutes(
      makeReq('GET', '/api/other'),
      makeRes(), '/api/other',
    );
    expect(result).toBe(false);
  });

  it('returns false for a PATCH on a cron sub-path', async () => {
    const result = await handleCronRoutes(
      makeReq('PATCH', '/api/cron/cron_abc123'),
      makeRes(), '/api/cron/cron_abc123',
    );
    expect(result).toBe(false);
  });
});
