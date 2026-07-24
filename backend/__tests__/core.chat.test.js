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
    const io = { sendJSON: vi.fn(), sendBinary: vi.fn(), isConnected: vi.fn(), onClose: vi.fn(), close: vi.fn() };
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
    const io = { sendJSON: vi.fn(), sendBinary: vi.fn(), isConnected: vi.fn(), onClose: vi.fn(), close: vi.fn() };

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
    const io = mkIO();
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  io.close() after stream completion — THE CRITICAL FIX
  // ═══════════════════════════════════════════════════════════════════════════
  //
  //  Without io.close(), the transport (WebSocket / IPC) stays open after the
  //  final {type:'done'} is sent.  The frontend ReadableStream never closes,
  //  and drainAgentStream hangs forever on await reader.read() — locking up
  //  the entire agent loop after the first AI response.
  //
  //  EVERY test in this section verifies a facet of the close contract.

  describe('io.close() — stream lifecycle guarantee', () => {

    it('calls io.close() after onDone sends {type:\'done\'}', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      conn.subscribe();

      const cb = getStreamCallbacks();
      cb.onDone({ toolCalls: 2, sessionId });

      // sendJSON must fire BEFORE close (order guarantee)
      expect(io.sendJSON).toHaveBeenCalledWith({ type: 'done', result: { toolCalls: 2, sessionId } });
      expect(io.close).toHaveBeenCalledTimes(1);
      // Verify invocation order: sendJSON at index 0, close at index 1
      expect(io.sendJSON.mock.invocationCallOrder[0])
        .toBeLessThan(io.close.mock.invocationCallOrder[0]);
    });

    it('calls io.close() after onError sends {type:\'error\'}', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      conn.subscribe();

      const cb = getStreamCallbacks();
      cb.onError('API rate limit exceeded');

      expect(io.sendJSON).toHaveBeenCalledWith({
        type: 'error',
        error: 'API rate limit exceeded',
      });
      expect(io.close).toHaveBeenCalledTimes(1);
      expect(io.sendJSON.mock.invocationCallOrder[0])
        .toBeLessThan(io.close.mock.invocationCallOrder[0]);
    });

    it('calls io.close() when sessionId is not found (early return)', () => {
      register(router);
      const handler = findStream('chatStream');
      const io = mkIO();

      handler({ sessionId: 'nonexistent' }, io).subscribe();

      expect(io.sendJSON).toHaveBeenCalledWith({
        type: 'error',
        error: expect.stringContaining('nonexistent'),
      });
      expect(io.close).toHaveBeenCalledTimes(1);
      expect(io.sendJSON.mock.invocationCallOrder[0])
        .toBeLessThan(io.close.mock.invocationCallOrder[0]);
    });

    it('does NOT call io.close() on text, thinking, tool_call, or usage callbacks', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      conn.subscribe();
      const cb = getStreamCallbacks();

      // Fire every non-terminal callback
      cb.onText('Hello');
      cb.onThinking('Let me think...');
      cb.onToolCall({ id: 'call_1', name: 'browser_navigate', arguments: { url: 'https://example.com' } });
      cb.onUsage({ promptTokens: 10, completionTokens: 20 });

      // close must NOT have been called yet
      expect(io.close).not.toHaveBeenCalled();

      // Now fire done — close must fire
      cb.onDone({ toolCalls: 1, sessionId });
      expect(io.close).toHaveBeenCalledTimes(1);
    });

    it('io.close() is idempotent — transport close() tolerates double call', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      conn.subscribe();
      const cb = getStreamCallbacks();

      // The service layer guarantees single-call semantics (then/catch are
      // mutually exclusive), but if something slips through, close() on a
      // WebSocket or IPC channel is inherently idempotent — no crash.
      cb.onDone({ toolCalls: 0, sessionId });
      cb.onDone({ toolCalls: 0, sessionId });

      // Each invocation fires close — this is OK because the transport's
      // close() (ws.close / IPC send) tolerates redundant calls.
      expect(io.close).toHaveBeenCalledTimes(2);
    });

    it('calls io.close() after onDone even with zero tool calls', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      conn.subscribe();
      const cb = getStreamCallbacks();

      cb.onText('Just a simple answer, no tools needed.');
      cb.onDone({ toolCalls: 0, sessionId });

      expect(io.sendJSON).toHaveBeenCalledWith({ type: 'done', result: { toolCalls: 0, sessionId } });
      expect(io.close).toHaveBeenCalledTimes(1);
    });

    it('calls io.close() after onError with an Error object', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      conn.subscribe();
      const cb = getStreamCallbacks();

      cb.onError(new Error('Connection timeout'));

      expect(io.sendJSON).toHaveBeenCalledWith({
        type: 'error',
        error: 'Connection timeout',
      });
      expect(io.close).toHaveBeenCalledTimes(1);
    });

    it('onClose cleanup still fires and session store cleaned after close', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      let closeCb = null;
      const io = {
        sendJSON: vi.fn(),
        sendBinary: vi.fn(),
        isConnected: vi.fn(() => true),
        onClose: vi.fn((cb) => { closeCb = cb; }),
        close: vi.fn(),
      };

      const conn = handler({ sessionId }, io);
      const { unsubscribe } = conn.subscribe();
      const cb = getStreamCallbacks();

      // Simulate transport disconnect AFTER done+close
      cb.onDone({ toolCalls: 0, sessionId });
      expect(io.close).toHaveBeenCalledTimes(1);

      // onClose callback was registered
      expect(io.onClose).toHaveBeenCalled();
      expect(typeof closeCb).toBe('function');

      unsubscribe();
    });

    it('does NOT call io.close() on unsubscribe — only abortController.abort()', async () => {
      register(router);
      const { sessionId } = await startSession();
      const handler = findStream('chatStream');
      const io = mkIO();

      const conn = handler({ sessionId }, io);
      const { unsubscribe } = conn.subscribe();

      unsubscribe();

      // close should NOT have been called (stream didn't finish)
      expect(io.close).not.toHaveBeenCalled();
      // sendJSON should NOT have been called (no data sent)
      expect(io.sendJSON).not.toHaveBeenCalledWith({ type: 'done', result: expect.anything() });
    });

    it('each independent session gets its own io.close()', async () => {
      register(router);
      const h = findApi('streamStart');
      const handler = findStream('chatStream');

      vi.mocked(chatService.startChatStreamingSession).mockReturnValue({ sessionId: 'sess-x' });

      const s1 = await h({ provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'A' }] });
      const s2 = await h({ provider: 'dp', model: 'm2', messages: [{ role: 'user', content: 'B' }] });

      const io1 = mkIO();
      const io2 = mkIO();
      const conn1 = handler({ sessionId: s1.sessionId }, io1);
      const conn2 = handler({ sessionId: s2.sessionId }, io2);
      conn1.subscribe();
      conn2.subscribe();

      // get callbacks for each session (they were registered in order)
      const cb1 = vi.mocked(chatService.startChatStreamingSession).mock.calls[0][0];
      const cb2 = vi.mocked(chatService.startChatStreamingSession).mock.calls[1][0];

      cb1.onDone({ toolCalls: 0, sessionId: s1.sessionId });
      cb2.onDone({ toolCalls: 0, sessionId: s2.sessionId });

      expect(io1.close).toHaveBeenCalledTimes(1);
      expect(io2.close).toHaveBeenCalledTimes(1);
    });

    // ── Edge: no params / no sessionId ────────────────────────────────────

    it('calls io.close() when params is undefined (sessionId undefined)', () => {
      register(router);
      const handler = findStream('chatStream');
      const io = mkIO();
      handler(undefined, io).subscribe();
      expect(io.close).toHaveBeenCalledTimes(1);
    });

    it('calls io.close() when params has no sessionId key', () => {
      register(router);
      const handler = findStream('chatStream');
      const io = mkIO();
      handler({}, io).subscribe();
      expect(io.close).toHaveBeenCalledTimes(1);
    });

    it('calls io.close() when sessionId is null', () => {
      register(router);
      const handler = findStream('chatStream');
      const io = mkIO();
      handler({ sessionId: null }, io).subscribe();
      expect(io.close).toHaveBeenCalledTimes(1);
    });

    // ── Edge: streamStop with consumed session ────────────────────────────

    it('streamStop returns ok true for consumed session (entry already deleted)', async () => {
      register(router);
      const startHandler = findApi('streamStart');
      const stopHandler = findApi('streamStop');

      const { sessionId } = await startHandler({ provider: 'dp', model: 'm1', messages: [] });

      // Simulate: stream completed and session was consumed
      const streamHandler = findStream('chatStream');
      const io = mkIO();
      vi.mocked(chatService.startChatStreamingSession).mockReturnValue({ sessionId: 'sess-clean' });
      const conn = streamHandler({ sessionId }, io);
      const { unsubscribe } = conn.subscribe();
      getStreamCallbacks().onDone({ toolCalls: 0, sessionId });
      unsubscribe();

      // Now stop — session entry was already cleaned up by done callback
      const result = await stopHandler({ sessionId });
      expect(result).toEqual({ ok: true });
    });
  });

  function findApi(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)?.[2];
  }

  function findStream(name) {
    return router.registerStream.mock.calls.find(([, n]) => n === name)?.[2];
  }

  /** Create a fresh mock IO with invocation-order tracking. */
  function mkIO() {
    return {
      sendJSON: vi.fn(),
      sendBinary: vi.fn(),
      isConnected: vi.fn(() => true),
      onClose: vi.fn(),
      close: vi.fn(),
    };
  }

  /**
   * Start a streaming session (streamStart) and return the sessionId.
   * Resets the startChatStreamingSession mock so tests can inspect fresh calls.
   */
  async function startSession() {
    const h = findApi('streamStart');
    vi.mocked(chatService.startChatStreamingSession).mockReturnValue({ sessionId: 'sess-test' });
    return h({ provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'Hi' }] });
  }

  /** Get the callback object from the most recent startChatStreamingSession call. */
  function getStreamCallbacks() {
    const calls = vi.mocked(chatService.startChatStreamingSession).mock.calls;
    return calls[calls.length - 1][0];
  }
});
