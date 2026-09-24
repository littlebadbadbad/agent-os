/**
 * Tests for agent-UI/app/apiClient.ts — HTTP (standalone) mode
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock env to NOT be Electron IPC
vi.mock('../env', () => ({ IS_ELECTRON_IPC: false, IS_DEBUG: false }));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Track all created WebSocket instances for test inspection.
const wsInstances: MockWebSocket[] = [];

beforeEach(() => { wsInstances.length = 0; });

class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string | Blob }) => void) | null = null;
  readyState: number = 0; // CONNECTING initially; set to 1 via simulateOpen()
  closed = false;

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
    // Simulate async open — most tests rely on readyState=1
    setTimeout(() => {
      if (!this.closed) {
        this.readyState = 1;
        this.onopen?.();
      }
    }, 0);
  }

  close() {
    this.closed = true;
    this.readyState = 3; // CLOSED
    // Per spec, close() triggers onclose synchronously-ish.
    this.onclose?.({ code: 1000, reason: 'normal' });
  }

  /** Test helper: simulate a message from the server. */
  simulateMessage(data: string | ArrayBuffer) {
    if (!this.closed) {
      this.onmessage?.({ data: data as any });
    }
  }
}
vi.stubGlobal('WebSocket', MockWebSocket as any);

import { createAppApiClient } from '../app/apiClient';
import type { AppApiError } from '../app/apiClient';

describe('AppApiClient — HTTP mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  describe('call', () => {
    it('sends POST to /api/app/<id>/<method> with JSON body', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ result: 'ok' }) });
      const client = createAppApiClient('test-app');

      const result = await client.call('doStuff', { key: 'val' });

      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/app/test-app/doStuff',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'val' }),
        }),
      );
    });

    it('sends POST without body when params omitted', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve('ok') });
      const client = createAppApiClient('system');

      await client.call('health');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/app/system/health',
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        }),
      );
    });

    it('handles HTTP errors with AppApiError', async () => {
      const responseBody = 'Server error';
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve(responseBody),
      });
      const client = createAppApiClient('test', { invoke: undefined });

      try {
        await client.call('fail');
        expect.unreachable();
      } catch (err) {
        const apiErr = err as AppApiError;
        expect(apiErr.status).toBe('network');
        expect(apiErr.appId).toBe('test');
        expect(apiErr.method).toBe('fail');
        expect(apiErr.message).toContain('500');
      }
    });

    it('handles fetch rejection (network error)', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));
      const client = createAppApiClient('test');

      try {
        await client.call('fail');
        expect.unreachable();
      } catch (err) {
        const apiErr = err as AppApiError;
        expect(apiErr.status).toBe('network');
        expect(apiErr.message).toContain('Network failure');
      }
    });

    it('encodes method name in URL', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const client = createAppApiClient('my-app');

      await client.call('special/method');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('special%2Fmethod'),
        expect.anything(),
      );
    });
  });

  describe('connectStream — HTTP/WebSocket lifecycle', () => {
    beforeEach(() => {
      // Default location: http, localhost
      vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' });
    });

    it('creates WebSocket with correct ws:// URL (http page)', () => {
      const client = createAppApiClient('chat');
      const streamClient = client.connectStream('chatStream', { sessionId: 'sess-1' });

      streamClient.subscribe();

      expect(wsInstances).toHaveLength(1);
      expect(wsInstances[0].url).toBe(
        'ws://localhost:5173/api/app/chat/chatStream?sessionId=sess-1',
      );
    });

    it('creates WebSocket with wss:// URL for https pages', () => {
      vi.stubGlobal('location', { protocol: 'https:', host: 'example.com' });

      const client = createAppApiClient('browser');
      const streamClient = client.connectStream('frames', { id: 'b1' });

      streamClient.subscribe();

      expect(wsInstances[0].url).toBe(
        'wss://example.com/api/app/browser/frames?id=b1',
      );
    });

    it('rejects duplicate subscribe calls with a no-op unsubscribe', () => {
      const client = createAppApiClient('test');
      const streamClient = client.connectStream('s');

      const sub1 = streamClient.subscribe();
      const sub2 = streamClient.subscribe();

      // Only one WebSocket should have been created
      expect(wsInstances).toHaveLength(1);

      // Both unsubscribes are safe to call
      expect(() => sub1.unsubscribe()).not.toThrow();
      expect(() => sub2.unsubscribe()).not.toThrow();
    });

    it('delivers JSON messages from the server to onData', () => {
      const client = createAppApiClient('test');
      const streamClient = client.connectStream('s');

      const onDataSpy = vi.fn();
      streamClient.callbacks.onData = onDataSpy;
      streamClient.subscribe();

      // Simulate a message from the server
      wsInstances[0].simulateMessage(JSON.stringify({ output: 'hello' }));

      expect(onDataSpy).toHaveBeenCalledWith({ output: 'hello' });
    });

    it('delivers end signal via onclose to onEnd', () => {
      const client = createAppApiClient('test');
      const streamClient = client.connectStream('s');

      const onEndSpy = vi.fn();
      streamClient.callbacks.onEnd = onEndSpy;
      streamClient.subscribe();

      // Simulate server closing the connection
      wsInstances[0].onclose?.({ code: 1000, reason: 'normal' });

      expect(onEndSpy).toHaveBeenCalledOnce();
    });

    it('unsubscribe prevents onEnd from firing when close triggers onclose', () => {
      const client = createAppApiClient('test');
      const streamClient = client.connectStream('s');

      const onEndSpy = vi.fn();
      streamClient.callbacks.onEnd = onEndSpy;
      streamClient.subscribe();

      // Unsubscribe (which calls ws.close, which triggers onclose synchronously)
      streamClient.subscribe().unsubscribe();

      // onEnd should NOT have been called — the subscribed=false guard
      // in onclose prevents the double-fire
      expect(onEndSpy).not.toHaveBeenCalled();
    });

    it('calls onError via onerror', () => {
      const client = createAppApiClient('test');
      const streamClient = client.connectStream('s');

      const onErrorSpy = vi.fn();
      streamClient.callbacks.onError = onErrorSpy;
      streamClient.subscribe();

      wsInstances[0].onerror?.(new Event('error'));

      expect(onErrorSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'WebSocket error',
      }));
    });

    it('drops messages received after unsubscribe', () => {
      const client = createAppApiClient('test');
      const streamClient = client.connectStream('s');

      const onDataSpy = vi.fn();
      streamClient.callbacks.onData = onDataSpy;
      const sub = streamClient.subscribe();
      sub.unsubscribe();

      // Message arrives after unsubscribe — should be dropped
      const ws = wsInstances[0];
      ws.simulateMessage(JSON.stringify({ output: 'late' }));

      expect(onDataSpy).not.toHaveBeenCalled();
    });
  });
});
