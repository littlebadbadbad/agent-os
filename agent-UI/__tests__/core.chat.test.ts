/**
 * Tests for agent-UI/plugin/core/chat.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCall = vi.hoisted(() => vi.fn());
const mockConnectStream = vi.hoisted(() => vi.fn());
vi.mock('../plugin/apiClient', () => ({
  createPluginApiClient: () => ({ call: mockCall, connectStream: mockConnectStream }),
}));

import { sendAsync, sendStream } from '../plugin/core/chat';

describe('chat core plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('sendAsync', () => {
    it('calls chat.async with params', async () => {
      mockCall.mockResolvedValue({ text: 'Hello!', toolCalls: [] });
      const params = { provider: 'dp', model: 'm1', messages: [{ role: 'user' as const, content: 'Hi' }] };

      const result = await sendAsync(params);

      expect(result).toEqual({ text: 'Hello!', toolCalls: [] });
      expect(mockCall).toHaveBeenCalledWith('async', expect.objectContaining({ provider: 'dp', model: 'm1' }));
    });

    it('forwards errors', async () => {
      mockCall.mockRejectedValue(new Error('API error'));
      await expect(sendAsync({ provider: 'dp', model: 'm1', messages: [] })).rejects.toThrow('API error');
    });
  });

  describe('sendStream', () => {
    it('returns a ReadableStream', () => {
      const streamClient = {
        callbacks: { onData: vi.fn(), onEnd: vi.fn(), onError: vi.fn() },
        subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
      };
      mockCall.mockResolvedValue({ sessionId: 'sess-1' });
      mockConnectStream.mockReturnValue(streamClient);

      const stream = sendStream({ provider: 'dp', model: 'm1', messages: [] });

      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it('two-phase: calls streamStart then connectStream', async () => {
      const streamClient = {
        callbacks: { onData: vi.fn(), onEnd: vi.fn(), onError: vi.fn() },
        subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
      };
      mockCall.mockResolvedValue({ sessionId: 'sess-42' });
      mockConnectStream.mockReturnValue(streamClient);

      sendStream({ provider: 'dp', model: 'm1', messages: [{ role: 'user', content: 'Hi' }] });

      // Wait a microtask for start()
      await new Promise(process.nextTick);

      expect(mockCall).toHaveBeenCalledWith('streamStart', expect.objectContaining({ provider: 'dp' }));
      expect(mockConnectStream).toHaveBeenCalledWith('chatStream', { sessionId: 'sess-42' });
    });

    it('forwards chunks from stream to ReadableStream', async () => {
      const streamClient = {
        callbacks: { onData: vi.fn(), onEnd: vi.fn(), onError: vi.fn() },
        subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
      };
      mockCall.mockResolvedValue({ sessionId: 'sess-1' });
      mockConnectStream.mockReturnValue(streamClient);

      const stream = sendStream({ provider: 'dp', model: 'm1', messages: [] });

      // Wait for the async start() to complete so callbacks are wired
      await vi.waitFor(() => {
        expect(typeof streamClient.callbacks.onData).toBe('function');
      });

      const reader = stream.getReader();

      // Simulate receiving data chunks
      streamClient.callbacks.onData({ type: 'text', delta: 'Hello' });
      streamClient.callbacks.onData({ type: 'done', result: { text: 'Hello' } });
      streamClient.callbacks.onEnd();

      const chunk1 = await reader.read();
      expect(chunk1.value).toEqual({ type: 'text', delta: 'Hello' });
      const chunk2 = await reader.read();
      expect(chunk2.value).toEqual({ type: 'done', result: { text: 'Hello' } });
      const chunk3 = await reader.read();
      expect(chunk3.done).toBe(true);
    });

    it('calls streamStop on abort signal', async () => {
      const abortController = new AbortController();
      const mockUnsubscribe = vi.fn();
      const streamClient = {
        callbacks: { onData: vi.fn(), onEnd: vi.fn(), onError: vi.fn() },
        subscribe: vi.fn().mockReturnValue({ unsubscribe: mockUnsubscribe }),
      };
      mockCall.mockResolvedValue({ sessionId: 'sess-99' });
      mockConnectStream.mockReturnValue(streamClient);

      sendStream({ provider: 'dp', model: 'm1', messages: [], signal: abortController.signal });

      await new Promise(process.nextTick);

      abortController.abort();

      expect(mockCall).toHaveBeenCalledWith('streamStop', { sessionId: 'sess-99' });
    });
  });
});
