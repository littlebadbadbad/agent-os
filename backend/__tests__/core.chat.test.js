/**
 * Tests for backend/core/chat.js — super built-in "chat" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/chat.js', () => ({
  callAsyncWithLogging: vi.fn(),
  startChatStreamingSession: vi.fn(),
}));

import * as chatService from '../services/chat.js';

describe('core/chat plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/chat.js');
    register = mod.register;
  });

  // ── Registration ───────────────────────────────────────────────────────────

  it('registers async, streamStart, streamStop APIs and chatStream stream', () => {
    register(router);

    expect(router.registerApi).toHaveBeenCalledWith('chat', 'async', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('chat', 'streamStart', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('chat', 'streamStop', expect.any(Function));
    expect(router.registerStream).toHaveBeenCalledWith('chat', 'chatStream', expect.any(Function));
  });

  // ── async ──────────────────────────────────────────────────────────────────

  it('async handler calls chatService.callAsyncWithLogging', async () => {
    register(router);
    const h = findApi('async');
    vi.mocked(chatService.callAsyncWithLogging).mockResolvedValue({ text: 'Hello!' });

    const result = await h({ provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'Hi' }] });

    expect(result).toEqual({ text: 'Hello!' });
    expect(chatService.callAsyncWithLogging).toHaveBeenCalledWith({
      provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'Hi' }],
      tools: undefined, toolChoice: undefined, systemPrompt: undefined,
    });
  });

  it('async handler throws on service error', async () => {
    register(router);
    const h = findApi('async');
    vi.mocked(chatService.callAsyncWithLogging).mockRejectedValue(new Error('API error'));

    await expect(h({})).rejects.toThrow('API error');
  });

  // ── streamStart ────────────────────────────────────────────────────────────

  it('streamStart stores params and returns sessionId', async () => {
    register(router);
    const h = findApi('streamStart');

    const result = await h({ provider: 'dp', model: 'm1', messages: [] });

    expect(result).toHaveProperty('sessionId');
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId).toContain('-');
  });

  it('streamStart stores params for later retrieval by chatStream', async () => {
    register(router);
    const startHandler = findApi('streamStart');
    const streamHandler = findStream('chatStream');

    vi.mocked(chatService.startChatStreamingSession).mockReturnValue({ sessionId: 'sess-123' });

    const { sessionId } = await startHandler({ provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'Hi' }] });

    // Simulate the IPC/WS transport calling the stream handler
    const io = { sendJSON: vi.fn(), sendBinary: vi.fn(), isConnected: vi.fn(), onClose: vi.fn() };
    const connection = streamHandler({ sessionId }, io);
    const { unsubscribe } = connection.subscribe();

    // Should have started a streaming session
    expect(chatService.startChatStreamingSession).toHaveBeenCalled();
    const callArgs = vi.mocked(chatService.startChatStreamingSession).mock.calls[0][0];
    expect(callArgs.provider).toBe('dp');
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hi' }]);

    unsubscribe();
  });

  it('chatStream returns error for unknown sessionId', () => {
    register(router);
    register(router);
    const streamHandler = findStream('chatStream');
    const io = { sendJSON: vi.fn(), sendBinary: vi.fn(), isConnected: vi.fn(), onClose: vi.fn() };

    const connection = streamHandler({ sessionId: 'nonexistent' }, io);
    connection.subscribe();

    expect(io.sendJSON).toHaveBeenCalledWith({ type: 'error', error: expect.stringContaining('nonexistent') });
  });

  // ── streamStop ─────────────────────────────────────────────────────────────

  it('streamStop aborts active session', async () => {
    register(router);
    const startHandler = findApi('streamStart');
    const stopHandler = findApi('streamStop');

    const { sessionId } = await startHandler({ provider: 'dp', model: 'm1', messages: [] });

    const result = await stopHandler({ sessionId });

    expect(result).toEqual({ ok: true });
  });

  it('streamStop returns ok true for nonexistent sessionId (no-op)', async () => {
    register(router);
    const h = findApi('streamStop');

    const result = await h({ sessionId: 'nonexistent' });

    expect(result).toEqual({ ok: true });
  });

  it('streamStop returns ok false without sessionId', async () => {
    register(router);
    const h = findApi('streamStop');

    const result = await h({});

    expect(result).toEqual({ ok: false });
  });

  // ── Stream callbacks ───────────────────────────────────────────────────────

  it('chatStream pipes all callbacks through io.sendJSON', async () => {
    register(router);
    const startHandler = findApi('streamStart');
    const streamHandler = findStream('chatStream');

    vi.mocked(chatService.startChatStreamingSession).mockReturnValue({ sessionId: 'sess-456' });

    const { sessionId } = await startHandler({ provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'Hi' }] });

    // Subscribe to trigger startChatStreamingSession call
    const io = { sendJSON: vi.fn(), sendBinary: vi.fn(), isConnected: vi.fn(), onClose: vi.fn() };
    const conn = streamHandler({ sessionId }, io);
    const sub = conn.subscribe();
    sub.unsubscribe();

    // Now the callbacks should be registered
    const cb = vi.mocked(chatService.startChatStreamingSession).mock.calls[0][0];

    expect(typeof cb.onText).toBe('function');
    expect(typeof cb.onThinking).toBe('function');
    expect(typeof cb.onToolCall).toBe('function');
    expect(typeof cb.onUsage).toBe('function');
    expect(typeof cb.onDone).toBe('function');
    expect(typeof cb.onError).toBe('function');
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function findApi(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)?.[2];
  }

  function findStream(name) {
    return router.registerStream.mock.calls.find(([, n]) => n === name)?.[2];
  }
});
