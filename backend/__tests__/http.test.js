/**
 * Tests for backend/lib/http.js
 *
 * Covers:
 *   readBody  — valid JSON, empty body, invalid JSON, stream error
 *   send      — status code, content-type, body serialisation
 *   setCORS   — correct CORS headers
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readBody, send, setCORS } from '../lib/http.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate a Node.js IncomingMessage that emits the given body string. */
function makeReq(bodyStr) {
  const req = new EventEmitter();
  process.nextTick(() => {
    if (bodyStr !== undefined && bodyStr !== null) req.emit('data', bodyStr);
    req.emit('end');
  });
  return req;
}

/** Minimal mock for ServerResponse — captures status, headers and body. */
function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: null,
    writeHead(status, headers = {}) { this._status = status; Object.assign(this._headers, headers); },
    end(body) { this._body = body; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return res;
}

// ── readBody ──────────────────────────────────────────────────────────────────

describe('readBody', () => {
  it('parses a valid JSON body', async () => {
    const req = makeReq('{"hello":"world"}');
    const result = await readBody(req);
    expect(result).toEqual({ hello: 'world' });
  });

  it('returns {} for an empty body', async () => {
    const req = makeReq('');
    const result = await readBody(req);
    expect(result).toEqual({});
  });

  it('returns {} when no data event is emitted', async () => {
    const req = new EventEmitter();
    process.nextTick(() => req.emit('end'));
    const result = await readBody(req);
    expect(result).toEqual({});
  });

  it('rejects on invalid JSON', async () => {
    const req = makeReq('{not json}');
    await expect(readBody(req)).rejects.toThrow('Invalid JSON body');
  });

  it('rejects on stream error', async () => {
    const req = new EventEmitter();
    const streamError = new Error('socket hang up');
    process.nextTick(() => req.emit('error', streamError));
    await expect(readBody(req)).rejects.toThrow('socket hang up');
  });

  it('handles multiple data chunks', async () => {
    const req = new EventEmitter();
    process.nextTick(() => {
      req.emit('data', '{"a":');
      req.emit('data', '"b"}');
      req.emit('end');
    });
    const result = await readBody(req);
    expect(result).toEqual({ a: 'b' });
  });
});

// ── send ──────────────────────────────────────────────────────────────────────

describe('send', () => {
  it('sets the correct HTTP status code', () => {
    const res = makeRes();
    send(res, 201, { id: 1 });
    expect(res._status).toBe(201);
  });

  it('sets Content-Type to application/json', () => {
    const res = makeRes();
    send(res, 200, {});
    expect(res._headers['Content-Type']).toBe('application/json');
  });

  it('serialises the data as pretty-printed JSON', () => {
    const res = makeRes();
    send(res, 200, { foo: 'bar' });
    expect(JSON.parse(res._body)).toEqual({ foo: 'bar' });
  });

  it('sets Content-Length matching the body byte-length', () => {
    const res = makeRes();
    const data = { message: 'ok' };
    send(res, 200, data);
    const expected = Buffer.byteLength(JSON.stringify(data, null, 2));
    expect(Number(res._headers['Content-Length'])).toBe(expected);
  });

  it('handles arrays and nested objects', () => {
    const res = makeRes();
    const data = { items: [1, 2, 3], nested: { deep: true } };
    send(res, 200, data);
    expect(JSON.parse(res._body)).toEqual(data);
  });
});

// ── setCORS ───────────────────────────────────────────────────────────────────

describe('setCORS', () => {
  it('sets Access-Control-Allow-Origin to *', () => {
    const res = makeRes();
    setCORS(res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('allows GET, POST, DELETE, OPTIONS methods', () => {
    const res = makeRes();
    setCORS(res);
    const methods = res._headers['Access-Control-Allow-Methods'];
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
    expect(methods).toContain('OPTIONS');
  });

  it('allows Content-Type and Authorization headers', () => {
    const res = makeRes();
    setCORS(res);
    const allowed = res._headers['Access-Control-Allow-Headers'];
    expect(allowed).toContain('Content-Type');
    expect(allowed).toContain('Authorization');
  });
});
