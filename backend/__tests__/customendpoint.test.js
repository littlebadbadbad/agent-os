/**
 * Tests for backend/providers/customendpoint.js — AI provider orchestrator
 *
 * Covers: callAsync, callStream — verifies that the orchestrator correctly
 * resolves apiType and delegates to the right format converter.
 * The format converters themselves are tested separately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock ───────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockConverters = vi.hoisted(() => ({
  'chat-completions': { callAsync: vi.fn(), callStream: vi.fn() },
  'responses':        { callAsync: vi.fn(), callStream: vi.fn() },
  'messages':         { callAsync: vi.fn(), callStream: vi.fn() },
}));

const mockGetConverter = vi.hoisted(() => vi.fn((type) => mockConverters[type]));
const mockResolveApiType = vi.hoisted(() => vi.fn(async (name) => 'chat-completions'));
const mockResolveEndpoint = vi.hoisted(() => vi.fn());

vi.mock('../lib/format-converters/index.js', () => ({
  getConverter: (...a) => mockGetConverter(...a),
  resolveApiType: (...a) => mockResolveApiType(...a),
  resolveEndpoint: (...a) => mockResolveEndpoint(...a),
  registerConverter: vi.fn(),
}));

import { callAsync, callStream } from '../providers/customendpoint.js';

const MESSAGES = [{ role: 'user', content: 'Hello' }];
const onText = vi.fn();
const onThinking = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Reset converter mocks
  Object.values(mockConverters).forEach((c) => {
    c.callAsync.mockReset();
    c.callStream.mockReset();
  });
});

describe('callAsync', () => {
  it('delegates to chat-completions converter by default', async () => {
    const response = { text: 'Hello!', toolCalls: [] };
    mockConverters['chat-completions'].callAsync.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('chat-completions');

    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'deepseek-v4-flash', 'DeepSeek');

    expect(mockResolveApiType).toHaveBeenCalledWith('DeepSeek');
    expect(mockGetConverter).toHaveBeenCalledWith('chat-completions');
    expect(result).toEqual(response);
  });

  it('delegates to messages converter when apiType=messages', async () => {
    const response = { text: 'Hello from Claude!', toolCalls: [] };
    mockConverters['messages'].callAsync.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('messages');

    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'claude-3.5-sonnet', 'Anthropic');

    expect(mockGetConverter).toHaveBeenCalledWith('messages');
    expect(result).toEqual(response);
  });

  it('delegates to responses converter when apiType=responses', async () => {
    const response = { text: 'Hello from Responses!', toolCalls: [] };
    mockConverters['responses'].callAsync.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('responses');

    const result = await callAsync(MESSAGES, [], 'auto', undefined, '', 'gpt-5', 'OpenAI-Responses');

    expect(mockGetConverter).toHaveBeenCalledWith('responses');
    expect(result).toEqual(response);
  });

  it('forwards all parameters to converter', async () => {
    const response = { text: 'OK', toolCalls: [] };
    mockConverters['chat-completions'].callAsync.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('chat-completions');

    const signal = new AbortController().signal;
    await callAsync(MESSAGES, [{ type: 'function' }], 'auto', signal, 'Be helpful', 'my-model', 'MyProv');

    expect(mockConverters['chat-completions'].callAsync).toHaveBeenCalledWith(
      MESSAGES,
      [{ type: 'function' }],
      'auto',
      signal,
      'Be helpful',
      'my-model',
      'MyProv',
    );
  });
});

describe('callStream', () => {
  it('delegates to the correct converter', async () => {
    const response = { toolCalls: [] };
    mockConverters['chat-completions'].callStream.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('chat-completions');

    const result = await callStream(MESSAGES, [], 'auto', undefined, onText, onThinking, '', 'deepseek-v4-flash', 'DeepSeek');

    expect(mockGetConverter).toHaveBeenCalledWith('chat-completions');
    expect(result).toEqual(response);
  });

  it('delegates to messages converter for Anthropic', async () => {
    const response = { toolCalls: [] };
    mockConverters['messages'].callStream.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('messages');

    await callStream(MESSAGES, [], 'auto', undefined, onText, onThinking, '', 'claude-3-sonnet', 'Anthropic');

    expect(mockGetConverter).toHaveBeenCalledWith('messages');
    expect(mockConverters['messages'].callStream).toHaveBeenCalled();
  });

  it('forwards all parameters to converter callStream', async () => {
    const response = { toolCalls: [] };
    mockConverters['chat-completions'].callStream.mockResolvedValue(response);
    mockResolveApiType.mockResolvedValue('chat-completions');

    const signal = new AbortController().signal;
    await callStream(MESSAGES, [{ type: 'function' }], 'auto', signal, onText, onThinking, 'Be helpful', 'my-model', 'MyProv');

    expect(mockConverters['chat-completions'].callStream).toHaveBeenCalledWith(
      MESSAGES, [{ type: 'function' }], 'auto', signal, onText, onThinking, 'Be helpful', 'my-model', 'MyProv',
    );
  });
});
