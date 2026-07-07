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

/** Session-scoped IPC channel helper. */
const SID = 'test-session';
const CH = (name: string) => `chat:stream:${SID}:${name}`;

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ sessionId: SID });
  });

  it('invokes chat:stream:start with params (not chat:stream-start)', async () => {
    mockInvoke.mockResolvedValue({ sessionId: 'sess_1' });

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockInvoke).toHaveBeenCalledWith('chat:stream:start', DEFAULT_PARAMS);
    expect(mockInvoke).not.toHaveBeenCalledWith('chat:stream-start', expect.anything());

    stream.cancel();
  });

  it('registers listener on session-scoped chunk channel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOn).toHaveBeenCalledWith(CH('chunk'), expect.any(Function));
    expect(mockOn).not.toHaveBeenCalledWith('chat:stream-chunk', expect.any(Function));

    stream.cancel();
  });

  it('registers listener on session-scoped done channel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOn).toHaveBeenCalledWith(CH('done'), expect.any(Function));
    expect(mockOn).not.toHaveBeenCalledWith('chat:stream-done', expect.any(Function));

    stream.cancel();
  });

  it('registers listener on session-scoped error channel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOn).toHaveBeenCalledWith(CH('error'), expect.any(Function));
    expect(mockOn).not.toHaveBeenCalledWith('chat:stream-error', expect.any(Function));

    stream.cancel();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// sendStream — chunk delivery
// ═════════════════════════════════════════════════════════════════════════════

describe('sendStream (IPC) — chunk delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ sessionId: SID });
  });

  it('delivers text chunks pushed via session-scoped chunk channel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pushChunk = captureOnHandler(CH('chunk'));

    pushChunk({ type: 'text', delta: 'Hello' });
    pushChunk({ type: 'text', delta: ' world' });

    const pushDone = captureOnHandler(CH('done'));
    pushDone();

    const chunks = await collectStream(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'text', delta: ' world' });
  });

  it('delivers thinking chunks', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pushChunk = captureOnHandler(CH('chunk'));

    pushChunk({ type: 'thinking', delta: 'reasoning...' });
    pushChunk({ type: 'text', delta: 'Answer' });

    const pushDone = captureOnHandler(CH('done'));
    pushDone();

    const chunks = await collectStream(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'reasoning...' });
  });

  it('delivers tool_call chunks', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pushChunk = captureOnHandler(CH('chunk'));

    pushChunk({
      type: 'tool_call',
      call: { id: 'tc1', name: 'add', arguments: { a: 1 } },
    });

    const pushDone = captureOnHandler(CH('done'));
    pushDone();

    const chunks = await collectStream(stream);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      type: 'tool_call',
      call: { id: 'tc1', name: 'add', arguments: { a: 1 } },
    });
  });

  it('surfaces errors via session-scoped error channel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pushError = captureOnHandler(CH('error'));

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ sessionId: SID });
  });

  it('invokes chat:stream:stop with sessionId on cancel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stream.cancel();

    expect(mockInvoke).toHaveBeenCalledWith('chat:stream:stop', { sessionId: SID });
    expect(mockInvoke).not.toHaveBeenCalledWith('chat:stream-abort', expect.anything());
  });

  it('invokes chat:stream:stop with sessionId when abort signal fires', async () => {
    const abortController = new AbortController();
    chatTransport.sendStream({
      ...DEFAULT_PARAMS,
      signal: abortController.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    abortController.abort();

    expect(mockInvoke).toHaveBeenCalledWith('chat:stream:stop', { sessionId: SID });
  });

  it('stops delivering chunks after cancel', async () => {
    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pushChunk = captureOnHandler(CH('chunk'));

    stream.cancel();

    // After cancel, chunks should not be enqueued
    pushChunk({ type: 'text', delta: 'should be ignored' });

    const reader = stream.getReader();
  });
});
