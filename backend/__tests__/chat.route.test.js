/**
 * Tests for backend/transports/network/chat.js
 *   handleChatAsync  — POST /api/chat
 *   handleChatStream — POST /api/chat/stream
 *
 * The chat service is mocked — no real provider calls.
 * The logger is silenced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock chat service (transport delegates everything to it) ─────────────────

const mockCallAsyncWithLogging = vi.fn();
const mockCallStreamWithLogging = vi.fn();

vi.mock('../services/chat.js', () => ({
  callAsyncWithLogging: (...args) => mockCallAsyncWithLogging(...args),
  callStreamWithLogging: (...args) => mockCallStreamWithLogging(...args),
}));

import { handleChatAsync, handleChatStream } from '../transports/network/chat.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body) {
  const req = new EventEmitter();
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

/** Minimal mock ServerResponse that accumulates writes until ended. */
function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _chunks: [],
    _ended: false,
    writeHead(s, h = {}) { this._status = s; Object.assign(this._headers, h); },
    write(chunk) { this._chunks.push(chunk); },
    end(chunk) { if (chunk) this._chunks.push(chunk); this._ended = true; },
    setHeader(k, v) { this._headers[k] = v; },
    json() { return JSON.parse(this._chunks.join('')); },
    allText() { return this._chunks.join(''); },
  };
  return res;
}

const MESSAGES = [{ role: 'user', content: 'Hi' }];

// ── handleChatAsync ───────────────────────────────────────────────────────────

describe('handleChatAsync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with the service response', async () => {
    const response = { text: 'Hello!', toolCalls: [] };
    mockCallAsyncWithLogging.mockResolvedValue(response);

    const res = makeRes();
    await handleChatAsync(makeReq({ messages: MESSAGES }), res);

    expect(res._status).toBe(200);
    expect(res.json()).toEqual(response);
    expect(mockCallAsyncWithLogging).toHaveBeenCalledOnce();
  });

  it('passes provider, model, systemPrompt through to the service', async () => {
    mockCallAsyncWithLogging.mockResolvedValue({ text: 'ok', toolCalls: [] });
    const res = makeRes();
    await handleChatAsync(makeReq({
      provider: 'deepseek', model: 'deepseek-v3', messages: MESSAGES, systemPrompt: 'Be helpful',
    }), res);
    expect(mockCallAsyncWithLogging).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek', model: 'deepseek-v3', systemPrompt: 'Be helpful' }),
    );
  });

  it('returns 502 when the service rejects', async () => {
    mockCallAsyncWithLogging.mockRejectedValue(new Error('upstream timeout'));
    const res = makeRes();
    await handleChatAsync(makeReq({ messages: MESSAGES }), res);
    expect(res._status).toBe(502);
    expect(res.json().error).toMatch(/upstream timeout/);
  });

  it('forwards tools and toolChoice to the service', async () => {
    mockCallAsyncWithLogging.mockResolvedValue({ text: 'ok', toolCalls: [] });
    const sdkTools = [{ name: 'add' }];
    const res = makeRes();
    await handleChatAsync(makeReq({ messages: MESSAGES, tools: sdkTools, toolChoice: 'required' }), res);
    expect(mockCallAsyncWithLogging).toHaveBeenCalledWith(
      expect.objectContaining({ tools: sdkTools, toolChoice: 'required' }),
    );
  });

  it('defaults toolChoice to "auto" and tools to []', async () => {
    mockCallAsyncWithLogging.mockResolvedValue({ text: 'ok' });
    const res = makeRes();
    await handleChatAsync(makeReq({ messages: MESSAGES }), res);
    expect(mockCallAsyncWithLogging).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [], toolChoice: 'auto' }),
    );
  });
});

// ── handleChatStream ──────────────────────────────────────────────────────────

/**
 * Utility: set up callStreamWithLogging mock to invoke onText/onThinking callbacks,
 * then resolve with { text, toolCalls }.
 */
function setupStreamMock({ textChunks = [], thinkChunks = [], toolCalls = [] } = {}) {
  mockCallStreamWithLogging.mockImplementation((params) => {
    const { onText, onThinking } = params;
    textChunks.forEach((c) => onText(c));
    thinkChunks.forEach((c) => onThinking(c));
    return Promise.resolve({ text: textChunks.join(''), toolCalls });
  });
}

describe('handleChatStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('responds with text/event-stream headers', async () => {
    setupStreamMock();
    const res = makeRes();
    await handleChatStream(makeReq({ messages: MESSAGES }), res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
  });

  it('emits text chunks as SSE events', async () => {
    setupStreamMock({ textChunks: ['Hello', ' world'] });
    const res = makeRes();
    await handleChatStream(makeReq({ messages: MESSAGES }), res);

    const body = res.allText();
    expect(body).toContain('"type":"text"');
    expect(body).toContain('"delta":"Hello"');
    expect(body).toContain('"delta":" world"');
  });

  it('emits thinking chunks as SSE events', async () => {
    setupStreamMock({ thinkChunks: ['reasoning...'] });
    const res = makeRes();
    await handleChatStream(makeReq({ messages: MESSAGES }), res);

    expect(res.allText()).toContain('"type":"thinking"');
    expect(res.allText()).toContain('"delta":"reasoning..."');
  });

  it('emits tool_call events for each tool call with parsed arguments', async () => {
    // callStreamWithLogging returns tool calls already converted by
    // assembledToToolCall — arguments is a parsed object, not argsJson.
    const convertedTc = { id: 'tc1', name: 'add', arguments: { a: 1 } };
    setupStreamMock({ toolCalls: [convertedTc] });
    const res = makeRes();
    await handleChatStream(makeReq({ messages: MESSAGES }), res);

    const body = res.allText();
    expect(body).toContain('"type":"tool_call"');
    const chunks = body
      .split('\n')
      .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
      .map((l) => JSON.parse(l.slice(6)));
    const toolCallChunk = chunks.find((c) => c.type === 'tool_call');
    expect(toolCallChunk?.call?.arguments).toEqual({ a: 1 });
    expect(toolCallChunk?.call?.argsJson).toBeUndefined();
  });

  it('emits [DONE] at the end and closes the response', async () => {
    setupStreamMock();
    const res = makeRes();
    await handleChatStream(makeReq({ messages: MESSAGES }), res);
    expect(res.allText()).toContain('[DONE]');
    expect(res._ended).toBe(true);
  });

  it('emits an error text chunk on service failure', async () => {
    mockCallStreamWithLogging.mockRejectedValue(new Error('API down'));
    const res = makeRes();
    await handleChatStream(makeReq({ messages: MESSAGES }), res);
    expect(res.allText()).toContain('[Error: API down]');
    expect(res._ended).toBe(true);
  });

  it('does not emit an error chunk when the request was aborted', async () => {
    mockCallStreamWithLogging.mockImplementation((params) => {
      params.signal?.throwIfAbominated();
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const req = makeReq({ messages: MESSAGES });
    const res = makeRes();

    // Trigger abort before the handler processes
    const originalOn = req.on.bind(req);
    req.on = (event, cb) => {
      const emitter = originalOn(event, cb);
      if (event === 'close') {
        process.nextTick(() => req.emit('close'));
      }
      return emitter;
    };

    await handleChatStream(req, res);
    // The response still ends
    expect(res._ended).toBe(true);
  });

  it('emits error text chunk when the service rejects in stream mode', async () => {
    mockCallStreamWithLogging.mockRejectedValue(new Error('Unknown provider'));
    const res = makeRes();
    await handleChatStream(makeReq({ provider: 'nope', messages: MESSAGES }), res);
    expect(res.allText()).toContain('[Error: Unknown provider]');
    expect(res._ended).toBe(true);
  });
});
