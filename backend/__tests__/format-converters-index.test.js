/**
 * Tests for backend/lib/format-converters/index.js
 *
 * Paths: relative to test file at backend/__tests__/format-converters-index.test.js
 * Source: backend/lib/format-converters/index.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChatConv = vi.hoisted(() => ({ callAsync: vi.fn(), callStream: vi.fn() }));
const mockRespConv = vi.hoisted(() => ({ callAsync: vi.fn(), callStream: vi.fn() }));
const mockMsgConv = vi.hoisted(() => ({ callAsync: vi.fn(), callStream: vi.fn() }));
const mockResolveApiKey = vi.hoisted(() => vi.fn());
const mockGetMergedModelConfig = vi.hoisted(() => vi.fn());
const mockGetMergedProvider = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('../lib/format-converters/chat-completions.js', () => mockChatConv);
vi.mock('../lib/format-converters/responses.js', () => mockRespConv);
vi.mock('../lib/format-converters/messages.js', () => mockMsgConv);
vi.mock('../lib/format-converters/resolve-key.js', () => ({ resolveApiKey: mockResolveApiKey }));
vi.mock('../services/model-config.js', () => ({
  getMergedModelConfig: mockGetMergedModelConfig,
  getMergedProvider: mockGetMergedProvider,
}));
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLogger }));

let conv;
beforeEach(async () => {
  vi.clearAllMocks();
  conv = await import('../lib/format-converters/index.js');
});

describe('getConverter', () => {
  it('returns converter with expected methods for known types', () => {
    const cc = conv.getConverter('chat-completions');
    expect(cc).toHaveProperty('callAsync');
    expect(cc).toHaveProperty('callStream');

    const r = conv.getConverter('responses');
    expect(r).toHaveProperty('callAsync');
    expect(r).toHaveProperty('callStream');

    const m = conv.getConverter('messages');
    expect(m).toHaveProperty('callAsync');
    expect(m).toHaveProperty('callStream');
  });

  it('throws for unknown apiType', () => {
    expect(() => conv.getConverter('unknown')).toThrow('Unknown apiType "unknown"');
  });

  it('throws for null/undefined', () => {
    expect(() => conv.getConverter(null)).toThrow();
    expect(() => conv.getConverter(undefined)).toThrow();
  });
});

describe('registerConverter', () => {
  it('registers and retrieves a custom converter', () => {
    const custom = { callAsync: vi.fn(), callStream: vi.fn() };
    conv.registerConverter('my-custom-type', custom);
    expect(conv.getConverter('my-custom-type')).toBe(custom);
  });
});

describe('resolveEndpoint', () => {
  const modelConfig = {
    model: { id: 'gpt-4', url: 'https://api.openai.com/v1/chat/completions', maxTokens: 8192 },
    provider: { name: 'openai', apiType: 'chat-completions' },
  };

  it('returns endpoint info for valid provider+model', () => {
    mockGetMergedModelConfig.mockReturnValue(modelConfig);
    mockResolveApiKey.mockReturnValue('sk-test');
    const result = conv.resolveEndpoint('openai', 'gpt-4');
    expect(result).toEqual({
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-test',
      useProxy: false,
      modelConfig: modelConfig.model,
      providerConfig: modelConfig.provider,
    });
  });

  it('throws when model not found', () => {
    mockGetMergedModelConfig.mockReturnValue(null);
    expect(() => conv.resolveEndpoint('openai', 'unknown')).toThrow('Model "unknown" not found');
  });

  it('throws when model not found (no provider name)', () => {
    mockGetMergedModelConfig.mockReturnValue(null);
    expect(() => conv.resolveEndpoint('', 'foo')).toThrow(
      'Model "foo" not found in provider config.',
    );
  });

  it('throws when API key missing', () => {
    mockGetMergedModelConfig.mockReturnValue(modelConfig);
    mockResolveApiKey.mockReturnValue(null);
    expect(() => conv.resolveEndpoint('openai', 'gpt-4')).toThrow('API key for "openai" is not set');
  });

  it('throws when API key empty', () => {
    mockGetMergedModelConfig.mockReturnValue(modelConfig);
    mockResolveApiKey.mockReturnValue('');
    expect(() => conv.resolveEndpoint('openai', 'gpt-4')).toThrow('API key for "openai" is not set');
  });
});

describe('resolveApiType', () => {
  it('returns apiType from provider config', async () => {
    mockGetMergedProvider.mockReturnValue({ name: 'o', apiType: 'responses' });
    expect(await conv.resolveApiType('o')).toBe('responses');
  });

  it('defaults to chat-completions when no apiType', async () => {
    mockGetMergedProvider.mockReturnValue({ name: 'o' });
    expect(await conv.resolveApiType('o')).toBe('chat-completions');
  });

  it('defaults to chat-completions when provider not found', async () => {
    mockGetMergedProvider.mockReturnValue(undefined);
    expect(await conv.resolveApiType('x')).toBe('chat-completions');
  });

  it('falls back when apiType has no registered converter', async () => {
    mockGetMergedProvider.mockReturnValue({ name: 'c', apiType: 'custom-type' });
    const result = await conv.resolveApiType('c');
    expect(result).toBe('chat-completions');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('custom-type'));
  });
});
