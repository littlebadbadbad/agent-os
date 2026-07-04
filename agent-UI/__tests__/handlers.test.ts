/**
 * Tests for agent-UI/handlers/asyncHandler.ts and streamHandler.ts
 *
 * Mocks providerStore and chatTransport. Tests that handlers correctly
 * extract provider+model from the store and pass them to the transport.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock providerStore ────────────────────────────────────────────────────────

const mockProviderStore = vi.hoisted(() => ({
  get: vi.fn(),
  getSelection: vi.fn(),
  getSelectedModel: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  setSelection: vi.fn(),
}));

vi.mock('../store/providerStore', () => ({
  providerStore: mockProviderStore,
}));

// ── Mock chatTransport ────────────────────────────────────────────────────────

const mockSendAsync = vi.fn();
const mockSendStream = vi.fn();

vi.mock('../transport/chatTransport', () => ({
  chatTransport: {
    sendAsync: (...a: unknown[]) => mockSendAsync(...a),
    sendStream: (...a: unknown[]) => mockSendStream(...a),
  },
}));

import { asyncHandler } from '../handlers/asyncHandler';
import { streamHandler } from '../handlers/streamHandler';

const MESSAGES = [{ role: 'user' as const, content: 'Hello' }];
const HANDLER_OPTIONS = {
  tools: [],
  toolChoice: 'auto' as const,
  systemPrompt: 'Be helpful',
  signal: new AbortController().signal,
  callTool: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockProviderStore.getSelection.mockReturnValue({ providerId: 'DeepSeek', modelId: 'deepseek-v4-flash' });
  mockProviderStore.get.mockReturnValue('DeepSeek');
});

describe('asyncHandler', () => {
  it('sends async request with provider and model from store', async () => {
    const response = { text: 'Hello!', toolCalls: [] };
    mockSendAsync.mockResolvedValue(response);

    const result = await asyncHandler(MESSAGES, HANDLER_OPTIONS);

    expect(mockSendAsync).toHaveBeenCalledWith({
      provider: 'DeepSeek',
      model: 'deepseek-v4-flash',
      messages: MESSAGES,
      tools: HANDLER_OPTIONS.tools,
      toolChoice: HANDLER_OPTIONS.toolChoice,
      systemPrompt: HANDLER_OPTIONS.systemPrompt,
      signal: HANDLER_OPTIONS.signal,
    });
    expect(result).toEqual(response);
  });

  it('reads provider from store.get()', async () => {
    mockSendAsync.mockResolvedValue({ text: '', toolCalls: [] });
    await asyncHandler(MESSAGES, HANDLER_OPTIONS);
    expect(mockProviderStore.get).toHaveBeenCalled();
  });

  it('reads model from store.getSelection()', async () => {
    mockSendAsync.mockResolvedValue({ text: '', toolCalls: [] });
    await asyncHandler(MESSAGES, HANDLER_OPTIONS);
    expect(mockProviderStore.getSelection).toHaveBeenCalled();
  });
});

describe('streamHandler', () => {
  it('sends stream request with provider and model from store', async () => {
    const stream = new ReadableStream();
    mockSendStream.mockResolvedValue(stream);

    const result = await streamHandler(MESSAGES, HANDLER_OPTIONS);

    expect(mockSendStream).toHaveBeenCalledWith({
      provider: 'DeepSeek',
      model: 'deepseek-v4-flash',
      messages: MESSAGES,
      tools: HANDLER_OPTIONS.tools,
      toolChoice: HANDLER_OPTIONS.toolChoice,
      systemPrompt: HANDLER_OPTIONS.systemPrompt,
      signal: HANDLER_OPTIONS.signal,
    });
    expect(result).toBe(stream);
  });

  it('reads provider from store.get()', async () => {
    mockSendStream.mockResolvedValue(new ReadableStream());
    await streamHandler(MESSAGES, HANDLER_OPTIONS);
    expect(mockProviderStore.get).toHaveBeenCalled();
  });
});
