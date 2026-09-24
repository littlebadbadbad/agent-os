/**
 * Tests for the network debug recorder:
 *   - agent-UI/store/netLog.ts        (the subscriber store)
 *   - agent-UI/app/netLogClient.ts    (the AppApiClient decorator)
 *   - agent-UI/app/apiClient.ts       (IS_DEBUG wiring of the decorator)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppApiClient, AppStreamClient } from '@agent-type';

import { netLog, toErrorInfo } from '../store/netLog';
import { withNetRecording } from '../app/netLogClient';

// ── store/netLog ──────────────────────────────────────────────────────────────

describe('netLog store', () => {
  beforeEach(() => netLog.clear());

  it('records a call through start/end and exposes it in the snapshot', () => {
    const entry = netLog.startCall('system', 'publicKey', { a: 1 });
    expect(entry.kind).toBe('call');
    expect(entry.status).toBe('pending');
    expect(netLog.getSnapshot().entries).toHaveLength(1);

    netLog.endCall(entry, { publicKey: 'pem' });
    expect(entry.status).toBe('success');
    expect(entry.result).toEqual({ publicKey: 'pem' });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failed call with normalised error info', () => {
    const entry = netLog.startCall('system', 'boom', undefined);
    const err = Object.assign(new Error('nope'), { status: 'not-found' });
    netLog.failCall(entry, err);

    expect(entry.status).toBe('error');
    expect(entry.error?.name).toBe('Error');
    expect(entry.error?.message).toBe('nope');
    expect(entry.error?.status).toBe('not-found');
  });

  it('ignores a second terminal transition on the same call', () => {
    const entry = netLog.startCall('app', 'm', {});
    netLog.endCall(entry, 'first');
    netLog.failCall(entry, new Error('late'));
    expect(entry.status).toBe('success');
    expect(entry.result).toBe('first');
  });

  it('tracks stream lifecycle and chunk accounting', () => {
    const stream = netLog.startStream('app', 'live', {});
    expect(stream.phase).toBe('connecting');

    netLog.streamSubscribed(stream);
    expect(stream.phase).toBe('subscribed');

    netLog.streamChunk(stream, { hello: 'world' });
    netLog.streamChunk(stream, 'text chunk');
    netLog.streamChunk(stream, new Uint8Array(8));
    expect(stream.phase).toBe('open');
    expect(stream.chunkCount).toBe(3);
    expect(stream.byteCount).toBeGreaterThan(0);
    expect(stream.chunks.map((c) => c.kind)).toEqual(['json', 'text', 'binary']);

    netLog.streamEnded(stream);
    expect(stream.phase).toBe('ended');
    expect(stream.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('caps retained chunk samples but keeps the total count', () => {
    const stream = netLog.startStream('app', 'flood', {});
    for (let i = 0; i < 120; i++) netLog.streamChunk(stream, { i });
    expect(stream.chunkCount).toBe(120);
    expect(stream.chunks.length).toBeLessThanOrEqual(50);
  });

  it('aggregates string chunks into full concatenated text', () => {
    const stream = netLog.startStream('app', 'tokens', {});
    netLog.streamChunk(stream, 'Hel');
    netLog.streamChunk(stream, 'lo ');
    netLog.streamChunk(stream, 'world');
    expect(stream.aggregate.text).toBe('Hello world');
    expect(stream.aggregate.textChunks).toBe(3);
    expect(stream.aggregate.jsonChunks).toBe(0);
    expect(stream.aggregate.truncated).toBe(false);
  });

  it('aggregates string-valued JSON fields per key', () => {
    const stream = netLog.startStream('app', 'chat', {});
    netLog.streamChunk(stream, { role: 'assistant', content: 'Hi' });
    netLog.streamChunk(stream, { content: ' there' });
    expect(stream.aggregate.jsonChunks).toBe(2);
    expect([...stream.aggregate.fields]).toEqual([
      ['role', 'assistant'],
      ['content', 'Hi there'],
    ]);
  });

  it('ignores non-string / empty JSON values but still counts the chunk', () => {
    const stream = netLog.startStream('app', 'mixed', {});
    netLog.streamChunk(stream, { n: 1, nested: { a: 1 }, empty: '', s: 'ok' });
    expect(stream.aggregate.jsonChunks).toBe(1);
    expect([...stream.aggregate.fields]).toEqual([['s', 'ok']]);
  });

  it('counts non-string non-object chunks as "other" (kills aggregation)', () => {
    const stream = netLog.startStream('app', 'bin', {});
    netLog.streamChunk(stream, new Uint8Array(4));
    netLog.streamChunk(stream, [1, 2]);
    expect(stream.aggregate.otherChunks).toBe(2);
    expect(stream.aggregate.text).toBe('');
    expect(stream.aggregate.fields.size).toBe(0);
  });

  it('flags truncation once the text cap is exceeded', () => {
    const stream = netLog.startStream('app', 'huge', {});
    netLog.streamChunk(stream, 'x'.repeat(150_000));
    expect(stream.aggregate.truncated).toBe(true);
    expect(stream.aggregate.text.length).toBe(100_000);
  });

  it('flags truncation once the field-count cap is exceeded', () => {
    const stream = netLog.startStream('app', 'wide', {});
    const wide: Record<string, string> = {};
    for (let i = 0; i < 30; i++) wide[`k${i}`] = 'v';
    netLog.streamChunk(stream, wide);
    expect(stream.aggregate.truncated).toBe(true);
    expect(stream.aggregate.fields.size).toBe(24);
  });

  it('clear() empties the log and bumps the snapshot version', () => {
    netLog.startCall('app', 'm', {});
    const before = netLog.getSnapshot().version;
    netLog.clear();
    expect(netLog.getSnapshot().entries).toHaveLength(0);
    expect(netLog.getSnapshot().version).toBeGreaterThan(before);
  });

  it('notifies subscribers on structural changes', () => {
    const fn = vi.fn();
    const unsubscribe = netLog.subscribe(fn);
    netLog.startCall('app', 'm', {});
    expect(fn).toHaveBeenCalled();
    unsubscribe();
    fn.mockClear();
    netLog.startCall('app', 'm2', {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('toErrorInfo handles non-Error throws', () => {
    expect(toErrorInfo('string failure')).toEqual({ name: 'Error', message: 'string failure' });
  });
});

// ── app/netLogClient (decorator) ──────────────────────────────────────────────

/** A minimal in-memory AppApiClient whose stream callbacks we can drive. */
function makeFakeClient(): {
  client: AppApiClient;
  stream: AppStreamClient;
  callImpl: ReturnType<typeof vi.fn>;
} {
  const callImpl = vi.fn();
  const stream: AppStreamClient = {
    callbacks: { onData: () => {}, onEnd: () => {}, onError: () => {} },
    subscribe: () => ({ unsubscribe: vi.fn() }),
  };
  const client: AppApiClient = {
    call: callImpl as AppApiClient['call'],
    connectStream: () => stream,
  };
  return { client, stream, callImpl };
}

describe('withNetRecording', () => {
  beforeEach(() => netLog.clear());

  it('delegates call() and records success', async () => {
    const { client, callImpl } = makeFakeClient();
    callImpl.mockResolvedValue(42);
    const wrapped = withNetRecording(client, 'myapp');

    const result = await wrapped.call<number>('answer', { q: 1 });

    expect(result).toBe(42);
    expect(callImpl).toHaveBeenCalledWith('answer', { q: 1 });
    const entry = netLog.getSnapshot().entries[0];
    expect(entry.kind).toBe('call');
    if (entry.kind === 'call') {
      expect(entry.appId).toBe('myapp');
      expect(entry.name).toBe('answer');
      expect(entry.params).toEqual({ q: 1 });
      expect(entry.status).toBe('success');
      expect(entry.result).toBe(42);
    }
  });

  it('records a thrown call and rethrows', async () => {
    const { client, callImpl } = makeFakeClient();
    callImpl.mockRejectedValue(new Error('kaboom'));
    const wrapped = withNetRecording(client, 'myapp');

    await expect(wrapped.call('fail')).rejects.toThrow('kaboom');
    const entry = netLog.getSnapshot().entries[0];
    if (entry.kind !== 'call') throw new Error('expected call entry');
    expect(entry.status).toBe('error');
    expect(entry.error?.message).toBe('kaboom');
  });

  it('records stream chunks even when consumer sets callbacks after connectStream', () => {
    const { client, stream } = makeFakeClient();
    const wrapped = withNetRecording(client, 'myapp');
    const consumer = wrapped.connectStream('feed', { topic: 'x' });

    // Consumer assigns callbacks AFTER connectStream (typical usage).
    const seen: unknown[] = [];
    consumer.callbacks.onData = (c) => seen.push(c);
    let ended = false;
    consumer.callbacks.onEnd = () => {
      ended = true;
    };

    const sub = consumer.subscribe();

    // Transport pushes via the INNER client's callbacks.
    stream.callbacks.onData({ frame: 1 });
    stream.callbacks.onData({ frame: 2 });
    stream.callbacks.onEnd();

    const entry = netLog.getSnapshot().entries[0];
    if (entry.kind !== 'stream') throw new Error('expected stream entry');
    expect(entry.appId).toBe('myapp');
    expect(entry.name).toBe('feed');
    expect(entry.params).toEqual({ topic: 'x' });
    expect(entry.chunkCount).toBe(2);
    expect(entry.phase).toBe('ended');

    // Consumer callbacks still fire.
    expect(seen).toEqual([{ frame: 1 }, { frame: 2 }]);
    expect(ended).toBe(true);

    // Unsubscribing a stream that already ended must not resurrect it.
    sub.unsubscribe();
    expect(entry.phase).toBe('ended');
  });

  it('marks an open stream closed when unsubscribed before end', () => {
    const { client } = makeFakeClient();
    const wrapped = withNetRecording(client, 'myapp');
    const consumer = wrapped.connectStream('feed');
    const sub = consumer.subscribe();
    const entry = netLog.getSnapshot().entries[0];
    if (entry.kind !== 'stream') throw new Error('expected stream entry');
    sub.unsubscribe();
    expect(entry.phase).toBe('closed');
  });
});

// ── app/apiClient factory wiring ──────────────────────────────────────────────

describe('createAppApiClient records traffic when IS_DEBUG', () => {
  beforeEach(() => {
    netLog.clear();
    vi.resetModules();
    // IPC transport reads listeners off window.electronAPI at call time.
    vi.stubGlobal('window', {
      electronAPI: { invoke: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()), off: vi.fn(), removeAllListeners: vi.fn() },
    });
  });
  afterEach(() => {
    vi.doUnmock('../env');
    vi.unstubAllGlobals();
  });

  it('wraps the client with the recorder when debug is on', async () => {
    vi.doMock('../env', () => ({ IS_ELECTRON_IPC: true, IS_DEBUG: true }));
    // Import fresh so apiClient and netLog share this module graph instance.
    const { createAppApiClient } = await import('../app/apiClient');
    const { netLog: freshLog } = await import('../store/netLog');
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const client = createAppApiClient('system', { invoke });

    await client.call('status', {});

    const entries = freshLog.getSnapshot().entries;
    expect(entries).toHaveLength(1);
    if (entries[0].kind !== 'call') throw new Error('expected call');
    expect(entries[0].name).toBe('status');
    expect(entries[0].status).toBe('success');
  });

  it('does NOT record when debug is off', async () => {
    vi.doMock('../env', () => ({ IS_ELECTRON_IPC: true, IS_DEBUG: false }));
    const { createAppApiClient } = await import('../app/apiClient');
    const { netLog: freshLog } = await import('../store/netLog');
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const client = createAppApiClient('system', { invoke });

    await client.call('status', {});

    expect(freshLog.getSnapshot().entries).toHaveLength(0);
  });
});
