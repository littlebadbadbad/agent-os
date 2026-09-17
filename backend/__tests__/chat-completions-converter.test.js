/**
 * Tests for backend/lib/format-converters/chat-completions.js
 *
 * Covers: callAsync (thinking extraction, tool calls, error cases),
 * callStream (streaming, error cases), and the full converter interface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Disable http-client NETLOG before it is imported: post() would otherwise
// tee() the mocked response body and rebuild a new Response, so
// readSSEStream would receive a different stream object than resp.body.
vi.hoisted(() => {
  process.env.HTTP_LOG = 'off';
});

// ── Logger mock ───────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock dependencies ─────────────────────────────────────────────────────────

const mockResolveEndpoint = vi.hoisted(() => vi.fn());
const mockToOAIMessages = vi.hoisted(() => vi.fn(() => [{ role: 'system', content: 'You are a helpful assistant.' }]));
const mockReadSSEStream = vi.hoisted(() => vi.fn());
const mockAssembledToToolCall = vi.hoisted(() => vi.fn((tc) => ({ ...tc, type: 'function' })));
const mockExtractThinking = vi.hoisted(() => vi.fn((text) => ({ thinking: null, text })));

vi.mock('../lib/format-converters/index.js', () => ({
  resolveEndpoint: (...a) => mockResolveEndpoint(...a),
  registerConverter: vi.fn(),
}));

vi.mock('../lib/oai.js', () => ({
  toOAIMessages: (...a) => mockToOAIMessages(...a),
  readSSEStream: (...a) => mockReadSSEStream(...a),
  assembledToToolCall: (...a) => mockAssembledToToolCall(...a),
  extractThinking: (...a) => mockExtractThinking(...a),
}));

// Don't mock http-client - we'll mock fetch at the global level instead
// to properly test the full call chain

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { callAsync, callStream } from '../lib/format-converters/chat-completions.js';

const MESSAGES = [{ role: 'user', content: 'Hello' }];
const onText = vi.fn();
const onThinking = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveEndpoint.mockReturnValue({
    url: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: 'sk-test-key',
    modelConfig: { id: 'deepseek-v4-flash', url: 'https://api.deepseek.com/v1/chat/completions', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 },
    providerConfig: { name: 'DeepSeek' },
  });
});

describe('callAsync', () => {
  it('returns text response for a successful call', async () => {
    mockReadSSEStream.mockReset(); // not used in callAsync
    mockExtractThinking.mockReturnValue({ thinking: null, text: 'Hello back!' });

    const mockResp = { ok: true, status: 200, json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Hello back!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), text: vi.fn() };
    mockFetch.mockResolvedValue(mockResp);

    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek');

    expect(result.text).toBe('Hello back!');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(result.toolCalls).toBeUndefined();
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: vi.fn().mockResolvedValue('Unauthorized') });
    await expect(callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek'))
      .rejects.toThrow('DeepSeek API 401');
  });

  it('throws on empty response', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ choices: [] }) });
    await expect(callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek'))
      .rejects.toThrow('Empty response from DeepSeek API');
  });

  it('extracts thinking from reasoning_content field', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Final answer', reasoning_content: 'Chain of thought' } }],
    }) });
    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek');
    expect(result.text).toBe('Final answer');
    expect(result.thinking).toBe('Chain of thought');
  });

  it('extracts thinking from tag-mode via extractThinking', async () => {
    mockExtractThinking.mockReturnValueOnce({ thinking: 'My reasoning', text: 'Final answer' });
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: '<think>My reasoning</think>Final answer' } }],
    }) });
    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek');
    expect(result.text).toBe('Final answer');
    expect(result.thinking).toBe('My reasoning');
  });

  it('handles tool calls in response', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'get_weather', arguments: '{"city":"Beijing"}' } }] } }],
    }) });
    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_weather');
  });

  it('passes usage as undefined when missing from response', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'No usage' } }],
    }) });
    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek');
    expect(result.usage).toBeUndefined();
  });
});

describe('callStream', () => {
  it('streams response via readSSEStream', async () => {
    mockReadSSEStream.mockResolvedValue({ toolCalls: [] });
    const resp = { ok: true, body: new ReadableStream() };
    mockFetch.mockResolvedValue(resp);

    const result = await callStream(MESSAGES, [], 'auto', undefined, onText, onThinking, '', 'deepseek-v4-flash', 'DeepSeek');
    expect(mockReadSSEStream).toHaveBeenCalledWith(resp.body, onText, onThinking, 'field');
    expect(result).toEqual({ toolCalls: [] });
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 402, text: vi.fn().mockResolvedValue('Payment Required') });
    await expect(callStream(MESSAGES, [], 'auto', undefined, onText, onThinking, '', 'deepseek-v4-flash', 'DeepSeek'))
      .rejects.toThrow('DeepSeek API 402');
  });

  it('sets stream: true in request body', async () => {
    mockReadSSEStream.mockResolvedValue({ toolCalls: [] });
    mockFetch.mockResolvedValue({ ok: true, body: new ReadableStream() });

    await callStream(MESSAGES, [], 'auto', undefined, onText, onThinking, '', 'deepseek-v4-flash', 'DeepSeek');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });
});
