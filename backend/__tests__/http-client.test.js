/**
 * Tests for backend/lib/http-client.js — Shared HTTP utilities
 *
 * Covers: buildHeaders, buildAnthropicHeaders, post, throwHttpError,
 * parseUsage, parseAnthropicUsage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import {
  buildHeaders, buildAnthropicHeaders, post, throwHttpError,
  parseUsage, parseAnthropicUsage,
} from '../lib/http-client.js';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildHeaders', () => {
  it('builds standard headers with bearer token', () => {
    const h = buildHeaders('sk-test');
    expect(h).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' });
  });

  it('builds headers without auth when no key', () => {
    const h = buildHeaders(null);
    expect(h).toEqual({ 'Content-Type': 'application/json' });
    expect(h.Authorization).toBeUndefined();
  });

  it('omits Authorization when x-api-key is present', () => {
    const h = buildHeaders('sk-test', 'application/json', { 'x-api-key': 'key123' });
    expect(h.Authorization).toBeUndefined();
    expect(h['x-api-key']).toBe('key123');
  });

  it('supports custom content type', () => {
    const h = buildHeaders(null, 'application/json-patch+json');
    expect(h['Content-Type']).toBe('application/json-patch+json');
  });
});

describe('buildAnthropicHeaders', () => {
  it('builds Anthropic-specific headers', () => {
    const h = buildAnthropicHeaders('sk-ant-key');
    expect(h['x-api-key']).toBe('sk-ant-key');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['Content-Type']).toBe('application/json');
    expect(h.Authorization).toBeUndefined();
  });

  it('supports custom version header', () => {
    const h = buildAnthropicHeaders('sk-ant-key', '2025-01-01');
    expect(h['anthropic-version']).toBe('2025-01-01');
  });
});

describe('post', () => {
  it('sends POST request with JSON body', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const body = { model: 'test', messages: [] };
    await post('https://api.example.com/v1', { 'Content-Type': 'application/json' }, body, undefined);
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: undefined,
    });
  });

  it('forwards AbortSignal', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const signal = new AbortController().signal;
    await post('https://api.example.com/v1', {}, {}, signal);
    expect(mockFetch.mock.calls[0][1].signal).toBe(signal);
  });
});

describe('throwHttpError', () => {
  it('throws with status and body', async () => {
    const resp = { status: 401, text: vi.fn().mockResolvedValue('Unauthorized') };
    await expect(throwHttpError(resp, 'TestProvider')).rejects.toThrow('TestProvider API 401: Unauthorized');
  });

  it('handles text() rejection gracefully', async () => {
    const resp = { status: 500, text: vi.fn().mockRejectedValue(new Error('stream failed')) };
    await expect(throwHttpError(resp, 'Test')).rejects.toThrow('Test API 500: ');
  });

  it('truncates long error bodies', async () => {
    const longBody = 'x'.repeat(1000);
    const resp = { status: 400, text: vi.fn().mockResolvedValue(longBody) };
    await expect(throwHttpError(resp, 'Test')).rejects.toThrow(longBody.slice(0, 500));
  });
});

describe('parseUsage', () => {
  it('parses OpenAI-style usage', () => {
    expect(parseUsage({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }))
      .toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it('parses Anthropic-style usage (input/output tokens)', () => {
    expect(parseUsage({ input_tokens: 15, output_tokens: 25 }))
      .toEqual({ promptTokens: 15, completionTokens: 25, totalTokens: 40 });
  });

  it('returns undefined for null/undefined', () => {
    expect(parseUsage(null)).toBeUndefined();
    expect(parseUsage(undefined)).toBeUndefined();
  });

  it('handles missing fields with zeros', () => {
    expect(parseUsage({})).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

describe('parseAnthropicUsage', () => {
  it('parses Anthropic usage format', () => {
    expect(parseAnthropicUsage({ input_tokens: 10, output_tokens: 20 }))
      .toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it('returns undefined for null', () => {
    expect(parseAnthropicUsage(null)).toBeUndefined();
  });
});
