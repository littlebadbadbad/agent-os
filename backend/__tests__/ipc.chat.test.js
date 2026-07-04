/**
 * Tests for backend/transports/ipc/chat.js — Chat IPC handlers
 *
 * The IPC handler is a pure protocol layer that delegates to chatService.
 * We mock chatService + logger to isolate protocol logic.
 *
 * Coverage:
 *   chat:async        — success, error, params forwarding
 *   chat:stream:start — start stream, event push (text/thinking/tool_call/usage/done/error)
 *   chat:stream:stop  — abort session
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock chat service ─────────────────────────────────────────────────────────
//
// The IPC handler now uses callAsyncWithLogging and callStreamWithLogging
// (which internally handle audit logging and tool-call conversion).
// We mock these directly so tests exercise protocol-layer only.

const mockCallAsyncWithLogging = vi.fn();
const mockCallStreamWithLogging = vi.fn();
const mockStartChatStreamingSession = vi.fn();

vi.mock('../services/chat.js', () => ({
  callAsyncWithLogging: (...args) => mockCallAsyncWithLogging(...args),
  callStreamWithLogging: (...args) => mockCallStreamWithLogging(...args),
  startChatStreamingSession: (...args) => mockStartChatStreamingSession(...args),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────

import { registerChatHandlers } from '../transports/ipc/chat.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Create a mock ipcMain that records .handle() registrations. */
function createMockIpcMain() {
  const handlers = {};
  return {
    _handlers: handlers,
    handle(channel, fn) { handlers[channel] = fn; },
  };
}

/** Create a mock IPC event with a renderer sender. */
function makeEvent() {
  return {
    sender: {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    },
  };
}

const MESSAGES = [{ role: 'user', content: 'Hi' }];
const DEFAULT_PARAMS = { provider: 'doubao', messages: MESSAGES };

// ── Setup ─────────────────────────────────────────────────────────────────────

let ipcMain;

beforeEach(async () => {
  vi.clearAllMocks();
  // Clear any leftover stream state from previous tests
  const mod = await import('../lib/stream-registry.js');
  mod.streamRegistry.clearAll();
  ipcMain = createMockIpcMain();
  registerChatHandlers(ipcMain);
});

// ═════════════════════════════════════════════════════════════════════════════
// chat:async
// ═════════════════════════════════════════════════════════════════════════════

describe('chat:async', () => {
  const handler = () => ipcMain._handlers['chat:async'];

  it('calls chatService.callAsyncWithLogging with the correct params', async () => {
    mockCallAsyncWithLogging.mockResolvedValue({ text: 'Hello!', toolCalls: [] });

    const params = { provider: 'qwen', model: 'qwen-max', messages: MESSAGES, tools: [], toolChoice: 'auto', systemPrompt: 'Be helpful' };
    await handler()(makeEvent(), params);

    expect(mockCallAsyncWithLogging).toHaveBeenCalledOnce();
    expect(mockCallAsyncWithLogging).toHaveBeenCalledWith({
      provider: 'qwen', model: 'qwen-max', messages: MESSAGES, tools: [], toolChoice: 'auto', systemPrompt: 'Be helpful',
    });
  });

  it('returns the result from chatService.callAsyncWithLogging', async () => {
    const result = { text: 'Hello!', toolCalls: [] };
    mockCallAsyncWithLogging.mockResolvedValue(result);

    const output = await handler()(makeEvent(), DEFAULT_PARAMS);
    expect(output).toEqual(result);
  });

  it('throws on upstream error', async () => {
    const err = new Error('upstream timeout');
    mockCallAsyncWithLogging.mockRejectedValue(err);

    await expect(handler()(makeEvent(), DEFAULT_PARAMS)).rejects.toThrow('upstream timeout');
  });

  it('handles missing params gracefully', async () => {
    mockCallAsyncWithLogging.mockResolvedValue({ text: '', toolCalls: [] });
    await handler()(makeEvent(), undefined);
    expect(mockCallAsyncWithLogging).toHaveBeenCalledWith(expect.objectContaining({
      provider: undefined, messages: undefined,
    }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// chat:stream:start
// ═════════════════════════════════════════════════════════════════════════════

describe('chat:stream:start', () => {
  const handler = () => ipcMain._handlers['chat:stream:start'];

  beforeEach(() => {
    mockStartChatStreamingSession.mockReturnValue({
      sessionId: 'test-session',
      abortController: new AbortController(),
    });
  });

  it('returns a sessionId immediately', () => {
    const result = handler()(makeEvent(), DEFAULT_PARAMS);
    expect(result).toHaveProperty('sessionId');
    expect(typeof result.sessionId).toBe('string');
  });

  it('calls startChatStreamingSession with provider, messages, and callbacks', () => {
    handler()(makeEvent(), DEFAULT_PARAMS);

    expect(mockStartChatStreamingSession).toHaveBeenCalledOnce();
    const callArgs = mockStartChatStreamingSession.mock.calls[0][0];
    expect(callArgs.provider).toBe('doubao');
    expect(callArgs.messages).toBe(MESSAGES);
    expect(callArgs).toHaveProperty('onText');
    expect(callArgs).toHaveProperty('onThinking');
    expect(callArgs).toHaveProperty('onToolCall');
    expect(callArgs).toHaveProperty('onUsage');
    expect(callArgs).toHaveProperty('onDone');
    expect(callArgs).toHaveProperty('onError');
    expect(typeof callArgs.onText).toBe('function');
    expect(typeof callArgs.onThinking).toBe('function');
  });

  it('sends text chunks via event.sender.send', () => {
    const ev = makeEvent();
    handler()(ev, DEFAULT_PARAMS);

    const { onText } = mockStartChatStreamingSession.mock.calls[0][0];
    onText('Hello');
    onText(' world');

    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:chunk', { type: 'text', delta: 'Hello' });
    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:chunk', { type: 'text', delta: ' world' });
  });

  it('sends thinking chunks via event.sender.send', () => {
    const ev = makeEvent();
    handler()(ev, DEFAULT_PARAMS);

    const { onThinking } = mockStartChatStreamingSession.mock.calls[0][0];
    onThinking('reasoning step 1');

    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:chunk', { type: 'thinking', delta: 'reasoning step 1' });
  });

  it('sends tool_call events via event.sender.send', () => {
    const convertedToolCall = { id: 'tc1', function: { name: 'add', arguments: '{"a":1}' } };
    const ev = makeEvent();
    handler()(ev, DEFAULT_PARAMS);

    const { onToolCall } = mockStartChatStreamingSession.mock.calls[0][0];
    onToolCall(convertedToolCall);

    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:chunk', { type: 'tool_call', call: convertedToolCall });
  });

  it('sends usage event when present', () => {
    const usage = { promptTokens: 10, completionTokens: 20 };
    const ev = makeEvent();
    handler()(ev, DEFAULT_PARAMS);

    const { onUsage } = mockStartChatStreamingSession.mock.calls[0][0];
    onUsage(usage);

    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:chunk', { type: 'usage', usage });
  });

  it('sends done event with tool call count and sessionId', () => {
    const ev = makeEvent();
    handler()(ev, DEFAULT_PARAMS);

    const { onDone } = mockStartChatStreamingSession.mock.calls[0][0];
    onDone({ toolCalls: 2, sessionId: 'test-session' });

    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:done', { toolCalls: 2, sessionId: 'test-session' });
  });

  it('sends error event on stream failure', () => {
    const ev = makeEvent();
    handler()(ev, DEFAULT_PARAMS);

    const { onError } = mockStartChatStreamingSession.mock.calls[0][0];
    onError('API error');

    expect(ev.sender.send).toHaveBeenCalledWith('chat:stream:error', { error: 'API error', sessionId: 'test-session' });
  });

  it('does not send events when sender.isDestroyed() is true', () => {
    const ev = makeEvent();
    ev.sender.isDestroyed.mockReturnValue(true);
    handler()(ev, DEFAULT_PARAMS);

    const { onText, onToolCall, onDone, onError } = mockStartChatStreamingSession.mock.calls[0][0];
    onText('Hello');
    onToolCall({ id: 'tc1' });
    onDone({ toolCalls: 0, sessionId: 'test-session' });
    onError('error');

    expect(ev.sender.send).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// chat:stream:stop
// ═════════════════════════════════════════════════════════════════════════════

describe('chat:stream:stop', () => {
  const startHandler = () => ipcMain._handlers['chat:stream:start'];
  const stopHandler = () => ipcMain._handlers['chat:stream:stop'];

  it('returns { ok: true } even when no session exists', async () => {
    const result = await stopHandler()(makeEvent(), { sessionId: 'nonexistent' });
    expect(result).toEqual({ ok: true });
  });

  it('aborts an active streaming session', async () => {
    const abortController = new AbortController();
    mockStartChatStreamingSession.mockReturnValue({
      sessionId: 'test-session',
      abortController,
    });

    const ev = makeEvent();
    startHandler()(ev, DEFAULT_PARAMS);

    // Stop it
    const result = await stopHandler()(ev, { sessionId: 'test-session' });

    expect(result).toEqual({ ok: true });
    expect(abortController.signal.aborted).toBe(true);
  });

  it('cleans up the controller from the internal map after abort', async () => {
    const abortController = new AbortController();
    mockStartChatStreamingSession.mockReturnValue({
      sessionId: 'test-session',
      abortController,
    });

    const ev = makeEvent();
    startHandler()(ev, DEFAULT_PARAMS);

    await stopHandler()(ev, { sessionId: 'test-session' });

    // After stopping, starting a new stream should succeed
    mockStartChatStreamingSession.mockReturnValue({
      sessionId: 'new-session',
      abortController: new AbortController(),
    });

    const ev2 = makeEvent();
    const result2 = startHandler()(ev2, DEFAULT_PARAMS);
    expect(result2.sessionId).toBe('new-session');
  });
});
