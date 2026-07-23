/**
 * Tests for backend/services/chat.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCE = vi.hoisted(() => ({ callAsync: vi.fn(), callStream: vi.fn() }));
const mockAssembled = vi.hoisted(() => vi.fn((tc) => ({ ...tc, assembled: true })));
const mockLogChat = vi.hoisted(() => vi.fn());

vi.mock('../providers/customendpoint.js', () => mockCE);
vi.mock('../lib/oai.js', () => ({ assembledToToolCall: mockAssembled }));
vi.mock('../lib/chat-log.js', () => ({ logChat: mockLogChat }));
vi.mock('../lib/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

let chat;
beforeEach(async () => {
  vi.clearAllMocks();
  chat = await import('../services/chat.js');
});

async function tick() {
  await new Promise((r) => setTimeout(r, 50));
}

describe('callAsync', () => {
  const base = { provider: 'openai', model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] };

  it('delegates with default toolChoice=auto and empty tools', async () => {
    mockCE.callAsync.mockResolvedValue({ text: 'hello', toolCalls: [], usage: null });
    const result = await chat.callAsync(base);
    expect(mockCE.callAsync).toHaveBeenCalledWith(base.messages, [], 'auto', undefined, undefined, base.model, base.provider);
    expect(result).toEqual({ text: 'hello', toolCalls: [], usage: null });
  });

  it('wraps bare tools with type:function', async () => {
    mockCE.callAsync.mockResolvedValue({ text: 'ok', toolCalls: [] });
    const tools = [{ name: 'fn1', description: 'd', parameters: {} }];
    await chat.callAsync({ ...base, tools, toolChoice: 'none', signal: 'sig' });
    expect(mockCE.callAsync).toHaveBeenCalledWith(base.messages, [{ type: 'function', function: tools[0] }], 'none', 'sig', undefined, base.model, base.provider);
  });

  it('passes through already-wrapped tools', async () => {
    mockCE.callAsync.mockResolvedValue({ text: 'ok', toolCalls: [] });
    const tools = [{ type: 'function', function: { name: 'fn1' } }];
    await chat.callAsync({ ...base, tools });
    expect(mockCE.callAsync).toHaveBeenCalledWith(base.messages, tools, 'auto', undefined, undefined, base.model, base.provider);
  });

  it('handles empty tools', async () => {
    mockCE.callAsync.mockResolvedValue({ text: '', toolCalls: [] });
    await chat.callAsync({ ...base, tools: [] });
    expect(mockCE.callAsync).toHaveBeenCalledWith(base.messages, [], 'auto', undefined, undefined, base.model, base.provider);
  });
});

describe('callStream', () => {
  const p = { provider: 'o', model: 'g', messages: [{ role: 'user', content: 'hi' }], onText: vi.fn(), onThinking: vi.fn(), signal: 's' };

  it('delegates to callStream', async () => {
    mockCE.callStream.mockResolvedValue({ text: 'h', toolCalls: [], usage: null });
    const r = await chat.callStream(p);
    expect(mockCE.callStream).toHaveBeenCalledWith(p.messages, [], 'auto', 's', p.onText, p.onThinking, undefined, p.model, p.provider);
    expect(r.text).toBe('h');
  });
});

describe('logChatInteraction', () => {
  it('delegates to logChat', () => {
    const a = { provider: 'o', mode: 'async', messages: [], tools: [], toolChoice: 'auto', systemPrompt: '', responseText: 'h', responseToolCalls: [], error: null, durationMs: 100 };
    chat.logChatInteraction(a);
    expect(mockLogChat).toHaveBeenCalledWith(a);
  });
});

describe('callAsyncWithLogging', () => {
  const p = { provider: 'o', model: 'g', messages: [{ role: 'user', content: 'hi' }] };

  it('logs success', async () => {
    mockCE.callAsync.mockResolvedValue({ text: 'h', toolCalls: [], usage: null });
    const r = await chat.callAsyncWithLogging(p);
    expect(r.text).toBe('h');
    expect(mockLogChat).toHaveBeenCalledWith(expect.objectContaining({ mode: 'async', responseText: 'h', durationMs: expect.any(Number) }));
  });

  it('logs error and rethrows', async () => {
    mockCE.callAsync.mockRejectedValue(new Error('e'));
    await expect(chat.callAsyncWithLogging(p)).rejects.toThrow('e');
    expect(mockLogChat).toHaveBeenCalledWith(expect.objectContaining({ mode: 'async', error: 'e' }));
  });

  it('handles empty result', async () => {
    mockCE.callAsync.mockResolvedValue({ text: '', toolCalls: [], usage: null });
    expect((await chat.callAsyncWithLogging(p)).toolCalls).toEqual([]);
  });
});

describe('callStreamWithLogging', () => {
  const p = { provider: 'o', model: 'g', messages: [{ role: 'user', content: 'hi' }], onText: vi.fn(), onThinking: vi.fn(), signal: 's' };

  it('logs success, converts tool calls', async () => {
    mockCE.callStream.mockResolvedValue({ text: 'h', toolCalls: [{ id: 'a' }, { id: 'b' }], usage: { p: 10 } });
    const r = await chat.callStreamWithLogging(p);
    expect(mockAssembled).toHaveBeenCalledTimes(2);
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[0].assembled).toBe(true);
    expect(mockLogChat).toHaveBeenCalledWith(expect.objectContaining({ mode: 'stream', responseToolCalls: [{ id: 'a' }, { id: 'b' }] }));
  });

  it('logs null toolCalls when none', async () => {
    mockCE.callStream.mockResolvedValue({ text: 'ok', toolCalls: [], usage: null });
    await chat.callStreamWithLogging(p);
    expect(mockLogChat).toHaveBeenCalledWith(expect.objectContaining({ responseToolCalls: null }));
  });

  it('logs error and rethrows', async () => {
    mockCE.callStream.mockRejectedValue(new Error('e'));
    await expect(chat.callStreamWithLogging(p)).rejects.toThrow('e');
    expect(mockLogChat).toHaveBeenCalledWith(expect.objectContaining({ mode: 'stream', error: 'e' }));
  });
});

describe('startChatStreamingSession', () => {
  const cb = {
    provider: 'o', model: 'g', messages: [{ role: 'user', content: 'hi' }],
    tools: [], toolChoice: 'auto', systemPrompt: '',
    onText: vi.fn(), onThinking: vi.fn(), onToolCall: vi.fn(), onUsage: vi.fn(),
    onDone: vi.fn(), onError: vi.fn(),
  };

  it('returns sessionId and abortController', () => {
    mockCE.callStream.mockResolvedValue({ text: '', toolCalls: [], usage: null });
    const r = chat.startChatStreamingSession(cb);
    expect(typeof r.sessionId).toBe('string');
    expect(r.sessionId.length).toBeGreaterThan(0);
    expect(r.abortController).toBeInstanceOf(AbortController);
  });

  it('invokes callbacks on success', async () => {
    mockCE.callStream.mockResolvedValue({ text: 'd', toolCalls: [{ id: 'a' }], usage: { p: 5 } });
    chat.startChatStreamingSession(cb);
    await tick();
    expect(cb.onToolCall).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', assembled: true }));
    expect(cb.onUsage).toHaveBeenCalledWith({ p: 5 });
    expect(cb.onDone).toHaveBeenCalledWith(expect.objectContaining({ toolCalls: 1 }));
  });

  it('handles zero tool calls', async () => {
    mockCE.callStream.mockResolvedValue({ text: 'ok', toolCalls: [], usage: null });
    chat.startChatStreamingSession(cb);
    await tick();
    expect(cb.onToolCall).not.toHaveBeenCalled();
    expect(cb.onUsage).not.toHaveBeenCalled();
    expect(cb.onDone).toHaveBeenCalledWith(expect.objectContaining({ toolCalls: 0 }));
  });

  it('invokes onError on failure', async () => {
    mockCE.callStream.mockRejectedValue(new Error('fail'));
    chat.startChatStreamingSession(cb);
    await tick();
    expect(cb.onError).toHaveBeenCalledWith('fail');
  });

  it('skips onError when aborted', async () => {
    mockCE.callStream.mockRejectedValue(new Error('aborted'));
    const { abortController } = chat.startChatStreamingSession(cb);
    abortController.abort();
    await tick();
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('swallows callback errors', async () => {
    mockCE.callStream.mockResolvedValue({ text: 'x', toolCalls: [{ id: 'a' }], usage: { p: 1 } });
    cb.onToolCall.mockImplementation(() => { throw new Error('cb'); });
    cb.onDone.mockImplementation(() => { throw new Error('done'); });
    chat.startChatStreamingSession(cb);
    await tick();
    expect(cb.onToolCall).toHaveBeenCalled();
    expect(cb.onDone).toHaveBeenCalled();
  });

  it('generates unique sessionIds', () => {
    mockCE.callStream.mockResolvedValue({ text: '', toolCalls: [] });
    const s1 = chat.startChatStreamingSession(cb).sessionId;
    const s2 = chat.startChatStreamingSession(cb).sessionId;
    expect(s1).not.toBe(s2);
  });
});
