/**
 * Tests for backend/lib/format-converters/resolve-key.js — API key resolution
 *
 * Covers: resolveApiKey with runtime key store, env var fallback, null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetApiKey = vi.hoisted(() => vi.fn());
vi.mock('../lib/key-store.js', () => ({
  getApiKey: (...a) => mockGetApiKey(...a),
}));

import { resolveApiKey } from '../lib/format-converters/resolve-key.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveApiKey', () => {
  it('returns runtime key when available', () => {
    mockGetApiKey.mockReturnValue('runtime-key');
    expect(resolveApiKey('my-provider')).toBe('runtime-key');
  });

  it('falls through to env var for known providers', () => {
    mockGetApiKey.mockReturnValue(null);
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'env-key';
    expect(resolveApiKey('deepseek')).toBe('env-key');
    process.env.DEEPSEEK_API_KEY = prev;
  });

  it('returns null when nothing is set', () => {
    mockGetApiKey.mockReturnValue(null);
    expect(resolveApiKey('unknown-provider')).toBeNull();
  });

  it('handles Chinese provider names', () => {
    mockGetApiKey.mockReturnValue(null);
    const prev = process.env.DOUBAO_API_KEY;
    process.env.DOUBAO_API_KEY = 'huoshan-key';
    expect(resolveApiKey('火山方舟')).toBe('huoshan-key');
    process.env.DOUBAO_API_KEY = prev;
  });
});
