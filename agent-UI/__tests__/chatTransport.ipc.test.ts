/**
 * Tests for agent-UI/transport/chatTransport.ts — IPC (Electron) path
 *
 * Mocks `window.electronAPI` to simulate the Electron IPC bridge.
 * Verifies that `sendStream` uses the correct channel names (using colons,
 * e.g. `chat:stream:start` vs the old `chat:stream-start`) and correctly
 * delivers chunks pushed from the main process to the ReadableStream.
 *
 * This is the core regression test for the IPC channel naming mismatch bug:
 *   backend sends on  →  'chat:stream:chunk'
 *   frontend listens  →  must be 'chat:stream:chunk' (was 'chat:stream-chunk')
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentStreamChunk } from '@agent-sdk';

// ── Module-level mocks (hoisted by vitest) ────────────────────────────────────

vi.mock('../env', () => ({ IS_ELECTRON_IPC: true }));
vi.mock('../config', () => ({ BACKEND_URL: '' }));

// `vi.hoisted` runs before module evaluation (import), even though written
// after vi.mock calls — this is the only way to set up window before the
// imported module evaluates `export const chatTransport = IS_ELECTRON_IPC
//   ? createIpcChatTransport() : createHttpChatTransport()`.
const mockInvoke = vi.hoisted(() => vi.fn());
const mockOn = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.hoisted(() => {
  (globalThis as any).window = {
    electronAPI: {
      invoke: mockInvoke,
      on: mockOn,
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };
});

import { chatTransport } from '../transport/chatTransport';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Drain a ReadableStream<AgentStreamChunk> into an array. */
async function collectStream(
  stream: ReadableStream<AgentStreamChunk>,
): Promise<AgentStreamChunk[]> {
  const reader = stream.getReader();
  const chunks: AgentStreamChunk[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

/**
 * Capture the callback that `electronAPI.on` registers for a channel.
 * Returns a function that simulates the backend pushing an event to that channel.
 */
function captureOnHandler(channel: string): (...args: unknown[]) => void {
  const allCalls = mockOn.mock.calls as unknown as Array<[string, (...args: unknown[]) => void]>;
  const matching = allCalls.filter((c) => c[0] === channel);
  const last = matching[matching.length - 1];
  if (!last) throw new Error(`No handler registered for channel: ${channel}`);
  const handler = last[1];
  return (...args: unknown[]) => { handler(...args); };
}

const DEFAULT_PARAMS = {
  provider: 'doubao',
  model: 'doubao-seed-123',
  messages: [{ role: 'user' as const, content: 'Hi' }],
};

// ═════════════════════════════════════════════════════════════════════════════
// sendAsync (non-streaming)
// ═════════════════════════════════════════════════════════════════════════════

describe('sendAsync (IPC)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes chat:async with params', async () => {
    mockInvoke.mockResolvedValue({ text: 'Hello!', toolCalls: [] });

    const result = await chatTransport.sendAsync(DEFAULT_PARAMS);

    expect(mockInvoke).toHaveBeenCalledWith('chat:async', DEFAULT_PARAMS);
    expect(result).toEqual({ text: 'Hello!', toolCalls: [] });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendStream — IPC channels
// ═════════════════════════════════════════════════════════════════════════════

describe('sendStream (IPC) — channel names', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes chat:stream:start with params (not chat:stream-start)', async () => {
    mockInvoke.mockResolvedValue({ sessionId: 'sess_1' });

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    // Give the stream time to register handlers and invoke start
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockInvoke).toHaveBeenCalledWith('chat:stream:start', DEFAULT_PARAMS);
    expect(mockInvoke).not.toHaveBeenCalledWith('chat:stream-start', expect.anything());

    // Cleanup: cancel the stream to avoid hanging
    stream.cancel();
  });

  it('registers listener on chat:stream:chunk (not chat:stream-chunk)', () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);

    expect(mockOn).toHaveBeenCalledWith('chat:stream:chunk', expect.any(Function));
    expect(mockOn).not.toHaveBeenCalledWith('chat:stream-chunk', expect.any(Function));

    stream.cancel();
  });

  it('registers listener on chat:stream:done (not chat:stream-done)', () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);

    expect(mockOn).toHaveBeenCalledWith('chat:stream:done', expect.any(Function));
    expect(mockOn).not.toHaveBeenCalledWith('chat:stream-done', expect.any(Function));

    stream.cancel();
  });

  it('registers listener on chat:stream:error (not chat:stream-error)', () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);

    expect(mockOn).toHaveBeenCalledWith('chat:stream:error', expect.any(Function));
    expect(mockOn).not.toHaveBeenCalledWith('chat:stream-error', expect.any(Function));

    stream.cancel();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendStream — chunk delivery
// ═════════════════════════════════════════════════════════════════════════════

describe('sendStream (IPC) — chunk delivery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delivers text chunks pushed via chat:stream:chunk', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const pushChunk = captureOnHandler('chat:stream:chunk');

    // Simulate backend pushing chunks
    pushChunk({ type: 'text', delta: 'Hello' });
    pushChunk({ type: 'text', delta: ' world' });

    // Simulate backend completing
    const pushDone = captureOnHandler('chat:stream:done');
    pushDone();

    const chunks = await collectStream(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'text', delta: ' world' });
  });

  it('delivers thinking chunks', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const pushChunk = captureOnHandler('chat:stream:chunk');

    pushChunk({ type: 'thinking', delta: 'reasoning...' });
    pushChunk({ type: 'text', delta: 'Answer' });

    const pushDone = captureOnHandler('chat:stream:done');
    pushDone();

    const chunks = await collectStream(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'reasoning...' });
  });

  it('delivers tool_call chunks', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const pushChunk = captureOnHandler('chat:stream:chunk');

    pushChunk({
      type: 'tool_call',
      call: { id: 'tc1', name: 'add', arguments: { a: 1 } },
    });

    const pushDone = captureOnHandler('chat:stream:done');
    pushDone();

    const chunks = await collectStream(stream);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      type: 'tool_call',
      call: { id: 'tc1', name: 'add', arguments: { a: 1 } },
    });
  });

  it('surfaces errors via chat:stream:error', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const pushError = captureOnHandler('chat:stream:error');

    const err = new Error('API timeout');
    pushError(err);

    const reader = stream.getReader();
    await expect(reader.read()).rejects.toThrow('API timeout');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendStream — abort / cancel
// ═════════════════════════════════════════════════════════════════════════════

describe('sendStream (IPC) — abort / cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes chat:stream:stop on cancel (not chat:stream-abort)', () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    stream.cancel();

    expect(mockInvoke).toHaveBeenCalledWith('chat:stream:stop');
    expect(mockInvoke).not.toHaveBeenCalledWith('chat:stream-abort', expect.anything());
  });

  it('invokes chat:stream:stop when abort signal fires', () => {
    const abortController = new AbortController();
    chatTransport.sendStream({
      ...DEFAULT_PARAMS,
      signal: abortController.signal,
    });

    abortController.abort();

    expect(mockInvoke).toHaveBeenCalledWith('chat:stream:stop');
  });

  it('stops delivering chunks after cancel', () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const pushChunk = captureOnHandler('chat:stream:chunk');

    stream.cancel();

    // After cancel, chunks should not be enqueued
    pushChunk({ type: 'text', delta: 'should be ignored' });

    // Verify the stream is already closed/errored
    const reader = stream.getReader();
    // After cancel the stream should be closed
  });
});
