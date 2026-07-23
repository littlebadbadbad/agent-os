/**
 * Tests for agent-UI/plugin/apiClient.ts — HTTP (standalone) mode
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock env to NOT be Electron IPC
vi.mock('../env', () => ({ IS_ELECTRON_IPC: false }));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock WebSocket globally
class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string | Blob }) => void) | null = null;
  readyState: number = 1;
  constructor(url: string) { this.url = url; }
  close() { /* noop */ }
}
vi.stubGlobal('WebSocket', MockWebSocket as any);

import { createPluginApiClient } from '../plugin/apiClient';
import type { PluginApiError } from '../plugin/apiClient';

describe('PluginApiClient — HTTP mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  describe('call', () => {
    it('sends POST to /api/plugin/<id>/<method> with JSON body', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ result: 'ok' }) });
      const client = createPluginApiClient('test-plugin');

      const result = await client.call('doStuff', { key: 'val' });

      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/plugin/test-plugin/doStuff',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'val' }),
        }),
      );
    });

    it('sends POST without body when params omitted', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve('ok') });
      const client = createPluginApiClient('system');

      await client.call('health');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/plugin/system/health',
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        }),
      );
    });

    it('handles HTTP errors with PluginApiError', async () => {
      const responseBody = 'Server error';
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve(responseBody),
      });
      const client = createPluginApiClient('test', { invoke: undefined });

      try {
        await client.call('fail');
        expect.unreachable();
      } catch (err) {
        const apiErr = err as PluginApiError;
        expect(apiErr.status).toBe('network');
        expect(apiErr.pluginId).toBe('test');
        expect(apiErr.method).toBe('fail');
        expect(apiErr.message).toContain('500');
      }
    });

    it('handles fetch rejection (network error)', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));
      const client = createPluginApiClient('test');

      try {
        await client.call('fail');
        expect.unreachable();
      } catch (err) {
        const apiErr = err as PluginApiError;
        expect(apiErr.status).toBe('network');
        expect(apiErr.message).toContain('Network failure');
      }
    });

    it('encodes method name in URL', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const client = createPluginApiClient('my-plugin');

      await client.call('special/method');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('special%2Fmethod'),
        expect.anything(),
      );
    });
  });

  describe('connectStream', () => {
    it('creates WebSocket with correct URL', () => {
      vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' } as Location);

      const client = createPluginApiClient('chat');
      const streamClient = client.connectStream('chatStream', { sessionId: 'sess-1' });

      const sub = streamClient.subscribe();
      sub.unsubscribe();
    });

    it('creates WebSocket with wss for https pages', () => {
      vi.stubGlobal('location', { protocol: 'https:', host: 'example.com' } as Location);

      const client = createPluginApiClient('browser');
      const streamClient = client.connectStream('frames', { id: 'b1' });

      const sub = streamClient.subscribe();
      sub.unsubscribe();
    });
  });
});
