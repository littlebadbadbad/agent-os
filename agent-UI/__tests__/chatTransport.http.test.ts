/**
 * Tests for agent-UI/transport/chatTransport.ts �� HTTP (standalone) path
 *
 * chatTransport now delegates to the super built-in "chat" plugin
 * (agent-UI/plugin/core/chat.ts). This test verifies the delegation
 * layer works correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentStreamChunk, AgentTurnResponse } from '@agent-sdk';

// ���� Module-level mocks ����������������������������������������������������������������������������������������������������������������

vi.mock('../plugin/core/chat', () => ({
  sendAsync: vi.fn(),
  sendStream: vi.fn(),
}));

import { chatTransport } from '../transport/chatTransport';
import { sendAsync as mockSendAsync, sendStream as mockSendStream } from '../plugin/core/chat';

// ���� Helpers ��������������������������������������������������������������������������������������������������������������������������������������

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

const DEFAULT_PARAMS = {
  provider: 'doubao',
  model: 'doubao-seed-123',
  messages: [{ role: 'user' as const, content: 'Hi' }],
};

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// sendAsync (non-streaming)
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T

describe('sendAsync (HTTP)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to core chat.sendAsync with params', async () => {
    const response: AgentTurnResponse = { text: 'Hello!', toolCalls: [] };
    vi.mocked(mockSendAsync).mockResolvedValue(response);

    const result = await chatTransport.sendAsync(DEFAULT_PARAMS);
    expect(result).toEqual(response);
    expect(mockSendAsync).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'doubao',
      model: 'doubao-seed-123',
      messages: expect.any(Array),
    }));
  });

  it('forwards errors from core chat.sendAsync', async () => {
    vi.mocked(mockSendAsync).mockRejectedValue(new Error('Backend error'));
    await expect(chatTransport.sendAsync(DEFAULT_PARAMS)).rejects.toThrow('Backend error');
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// sendStream (streaming)
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T

describe('sendStream (HTTP)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to core chat.sendStream and returns its stream', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'text', delta: 'Hello' } as AgentStreamChunk,
      { type: 'done' } as unknown as AgentStreamChunk,
    ];
    const mockStream = createMockStream(chunks);
    vi.mocked(mockSendStream).mockReturnValue(mockStream);

    const stream = chatTransport.sendStream(DEFAULT_PARAMS);
    const result = await collectStream(stream);
    expect(result).toEqual(chunks);
    expect(mockSendStream).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'doubao',
    }));
  });
});

function createMockStream(chunks: AgentStreamChunk[]): ReadableStream<AgentStreamChunk> {
  return new ReadableStream<AgentStreamChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}
