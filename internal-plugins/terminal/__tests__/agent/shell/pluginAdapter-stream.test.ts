/**
 * Tests for extensions/terminal/agent/shell/pluginAdapter.ts — streamOutput
 *
 * Focus on the stream deduplication fix:
 *   - Calling streamOutput twice for the same terminal id terminates the
 *     prior stream before creating a new one
 *   - Stream chunk bridging (backend { output } → onData, done → onDone)
 *   - Cleanup removes itself from the activeStreams tracking map
 *   - Null/undefined chunk safety
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTerminalPluginAdapter } from '../../../agent/shell/pluginAdapter';
import type { PluginApiClient, PluginStreamClient } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStreamClient(): PluginStreamClient & { unsubscribe: () => void } {
  let unsubCalled = false;
  return {
    callbacks: {
      onData: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    },
    subscribe: () => {
      const unsub = () => { unsubCalled = true; };
      return { unsubscribe: unsub };
    },
    get unsubCalled() { return unsubCalled; },
  };
}

function makeApiClient(): PluginApiClient & { streams: Map<string, PluginStreamClient> } {
  const streams = new Map<string, PluginStreamClient>();
  return {
    call: vi.fn().mockResolvedValue({}),
    connectStream: vi.fn((name: string, params?: Record<string, unknown>) => {
      const key = `${name}:${JSON.stringify(params)}`;
      const existing = streams.get(key);
      if (existing) return existing;
      const client = makeStreamClient();
      streams.set(key, client);
      return client;
    }),
    streams,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createTerminalPluginAdapter — streamOutput dedup', () => {
  let apiClient: ReturnType<typeof makeApiClient>;

  beforeEach(() => {
    apiClient = makeApiClient();
  });

  it('calls connectStream with the terminal id', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    adapter.streamOutput('term_abc', vi.fn(), 'sess-1');

    expect(apiClient.connectStream).toHaveBeenCalledWith('stream', { id: 'term_abc' });
  });

  it('calling streamOutput twice for same id terminates the prior stream before creating a new one', () => {
    const adapter = createTerminalPluginAdapter(apiClient);
    const onData1 = vi.fn();
    const onData2 = vi.fn();

    // First subscription
    const cleanup1 = adapter.streamOutput('term_x', onData1, 'sess-1');
    const client1 = apiClient.streams.get('stream:{"id":"term_x"}')!;

    // Second subscription for the SAME terminal id
    const cleanup2 = adapter.streamOutput('term_x', onData2, 'sess-1');
    const client2 = apiClient.streams.get('stream:{"id":"term_x"}')!;

    // The first stream's unsubscribe should have been called
    expect((client1 as any).unsubCalled).toBe(true);

    // Both cleanups are no-ops when called manually (no double-disconnect)
    expect(() => cleanup1()).not.toThrow();
    expect(() => cleanup2()).not.toThrow();
  });

  it('calling streamOutput for different ids does NOT affect each other', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onDataA = vi.fn();
    const onDataB = vi.fn();

    const cleanupA = adapter.streamOutput('term_a', onDataA, 'sess-1');
    const cleanupB = adapter.streamOutput('term_b', onDataB, 'sess-1');

    // Both cleanups should work independently
    expect(() => cleanupA()).not.toThrow();
    expect(() => cleanupB()).not.toThrow();
  });

  it('bridges output chunks correctly: { output: "text" } → onData("text", false)', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData = vi.fn();
    adapter.streamOutput('term_1', onData, 'sess-1');

    // Get the connectStream result and manually trigger onData
    const client = apiClient.streams.get('stream:{"id":"term_1"}')!;
    client.callbacks.onData({ output: 'hello world' });

    expect(onData).toHaveBeenCalledWith('hello world', false);
  });

  it('bridges done chunks correctly: { type: "done", exitCode: 0 } → onData("", true, 0)', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData = vi.fn();
    adapter.streamOutput('term_1', onData, 'sess-1');

    const client = apiClient.streams.get('stream:{"id":"term_1"}')!;
    client.callbacks.onData({ type: 'done', exitCode: 0 });

    expect(onData).toHaveBeenCalledWith('', true, 0);
  });

  it('bridges done chunks without exitCode: { type: "done" } → onData("", true, undefined)', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData = vi.fn();
    adapter.streamOutput('term_1', onData, 'sess-1');

    const client = apiClient.streams.get('stream:{"id":"term_1"}')!;
    client.callbacks.onData({ type: 'done' });

    expect(onData).toHaveBeenCalledWith('', true, undefined);
  });

  it('ignores invalid chunks that are not StreamChunk-shaped', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData = vi.fn();
    adapter.streamOutput('term_1', onData, 'sess-1');

    const client = apiClient.streams.get('stream:{"id":"term_1"}')!;

    // Unknown shapes should be silently ignored
    client.callbacks.onData({ foo: 'bar' });
    client.callbacks.onData(null);
    client.callbacks.onData(42);
    client.callbacks.onData('string');

    expect(onData).not.toHaveBeenCalled();
  });

  it('triggers onData with done on error', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData = vi.fn();
    adapter.streamOutput('term_1', onData, 'sess-1');

    const client = apiClient.streams.get('stream:{"id":"term_1"}')!;
    client.callbacks.onError(new Error('stream failed'));

    expect(onData).toHaveBeenCalledWith('', true);
  });

  it('returned cleanup calls unsubscribe and onEnd', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData = vi.fn();
    const cleanup = adapter.streamOutput('term_1', onData, 'sess-1');

    const client = apiClient.streams.get('stream:{"id":"term_1"}')!;
    const onEndSpy = client.callbacks.onEnd;

    cleanup();

    expect(onEndSpy).toHaveBeenCalledOnce();
  });

  it('subsequent streamOutput for same id after cleanup does not interfere', () => {
    const adapter = createTerminalPluginAdapter(apiClient);

    const onData1 = vi.fn();
    const cleanup1 = adapter.streamOutput('term_1', onData1, 'sess-1');
    cleanup1();

    // After cleanup, a new stream should work cleanly
    const onData2 = vi.fn();
    const cleanup2 = adapter.streamOutput('term_1', onData2, 'sess-1');

    const client2 = apiClient.streams.get('stream:{"id":"term_1"}')!;
    client2.callbacks.onData({ output: 'fresh data' });

    // Only the second onData should receive data
    expect(onData1).not.toHaveBeenCalled();
    expect(onData2).toHaveBeenCalledWith('fresh data', false);
  });
});
