/**
 * Tests for agent-UI/components/NetDebug/streamAggregate.ts — the pure
 * display model over stream aggregates (plain-string / json-field / raw).
 */

import { describe, it, expect } from 'vitest';

import { computeStreamAggregate, fieldValue } from '../components/NetDebug/streamAggregate';
import type { NetStreamAggregate } from '../store/netLog';

function agg(overrides: Partial<NetStreamAggregate> = {}): NetStreamAggregate {
  return {
    text: '',
    fields: new Map<string, string>(),
    textChunks: 0,
    jsonChunks: 0,
    otherChunks: 0,
    truncated: false,
    ...overrides,
  };
}

describe('computeStreamAggregate', () => {
  it('is raw for an empty stream', () => {
    expect(computeStreamAggregate(agg())).toEqual({ mode: 'raw', truncated: false });
  });

  it('plain strings auto-concatenate', () => {
    const view = computeStreamAggregate(agg({ text: 'hello world', textChunks: 2 }));
    expect(view.mode).toBe('plain-string');
    if (view.mode === 'plain-string') expect(view.text).toBe('hello world');
  });

  it('json objects expose per-field concatenation', () => {
    const view = computeStreamAggregate(
      agg({
        jsonChunks: 3,
        fields: new Map([
          ['content', 'abc'],
          ['role', 'assistant'],
        ]),
      }),
    );
    expect(view.mode).toBe('json-field');
    if (view.mode === 'json-field') {
      expect(view.fields).toEqual(['content', 'role']);
      // default = field with the most content
      expect(view.defaultField).toBe('role');
    }
  });

  it('json chunks without any string values fall back to raw', () => {
    const view = computeStreamAggregate(agg({ jsonChunks: 2 }));
    expect(view.mode).toBe('raw');
  });

  it('mixed strings + json is raw (ambiguous)', () => {
    const view = computeStreamAggregate(agg({ textChunks: 1, jsonChunks: 1 }));
    expect(view.mode).toBe('raw');
  });

  it('any binary/other chunk disables aggregation', () => {
    const view = computeStreamAggregate(
      agg({ textChunks: 4, otherChunks: 1, text: 'nope' }),
    );
    expect(view.mode).toBe('raw');
  });

  it('propagates the truncated flag in every mode', () => {
    expect(computeStreamAggregate(agg({ truncated: true })).truncated).toBe(true);
    expect(
      computeStreamAggregate(agg({ textChunks: 1, text: 'x', truncated: true })).truncated,
    ).toBe(true);
    expect(
      computeStreamAggregate(
        agg({ jsonChunks: 1, fields: new Map([['a', 'b']]), truncated: true }),
      ).truncated,
    ).toBe(true);
  });
});

describe('fieldValue', () => {
  it('returns the concatenated field text or empty string', () => {
    const a = agg({ fields: new Map([['content', 'hi']]) });
    expect(fieldValue(a, 'content')).toBe('hi');
    expect(fieldValue(a, 'missing')).toBe('');
  });
});
