import { describe, it, expect, vi } from 'vitest';
import { createSystemPromptCache, SECTION_IDS } from '../../tools/prompts/section';
import type { SectionId } from '@agent-type';

describe('createSystemPromptCache', () => {
  it('returns a cache with resolve and invalidate', () => {
    const cache = createSystemPromptCache();
    expect(cache).toHaveProperty('resolve');
    expect(cache).toHaveProperty('invalidate');
    expect(typeof cache.resolve).toBe('function');
    expect(typeof cache.invalidate).toBe('function');
  });

  it('resolve calls the factory on first access', () => {
    const cache = createSystemPromptCache();
    const factory = vi.fn(() => 'section-content');
    const result = cache.resolve(SECTION_IDS[0], factory);
    expect(result).toBe('section-content');
    expect(factory).toHaveBeenCalledOnce();
  });

  it('resolve returns cached value on second access', () => {
    const cache = createSystemPromptCache();
    const factory = vi.fn(() => 'cached');
    cache.resolve(SECTION_IDS[0], factory);
    cache.resolve(SECTION_IDS[0], factory);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('resolve does NOT cache undefined results', () => {
    const cache = createSystemPromptCache();
    const factory = vi.fn(() => undefined);
    const first = cache.resolve(SECTION_IDS[0], factory);
    expect(first).toBeUndefined();
    const second = cache.resolve(SECTION_IDS[0], factory);
    expect(second).toBeUndefined();
    // Called twice because undefined is not cached
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('invalidate clears all cached values', () => {
    const cache = createSystemPromptCache();
    const factory = vi.fn(() => 'fresh');
    cache.resolve(SECTION_IDS[0], factory);
    cache.invalidate();
    cache.resolve(SECTION_IDS[0], factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('different sections are isolated in cache', () => {
    const cache = createSystemPromptCache();
    const fa = vi.fn(() => 'A');
    const fb = vi.fn(() => 'B');
    expect(cache.resolve(SECTION_IDS[0], fa)).toBe('A');
    expect(cache.resolve(SECTION_IDS[1], fb)).toBe('B');
    expect(fa).toHaveBeenCalledTimes(1);
    expect(fb).toHaveBeenCalledTimes(1);
  });

  it('entries returns a frozen snapshot of the cache', () => {
    const cache = createSystemPromptCache();
    cache.resolve(SECTION_IDS[0], () => 'content');
    const entries = cache.entries;
    expect(entries.get(SECTION_IDS[0])).toBe('content');
    expect(entries.size).toBe(1);
  });

  it('invalidate on empty cache does not throw', () => {
    const cache = createSystemPromptCache();
    expect(() => cache.invalidate()).not.toThrow();
  });
});

describe('SECTION_IDS', () => {
  it('contains expected sections', () => {
    expect(SECTION_IDS).toContain('task_tracking');
    expect(SECTION_IDS).toContain('memory_graph');
    expect(SECTION_IDS).toContain('terminal');
    expect(SECTION_IDS).toContain('upgrade');
    expect(SECTION_IDS).toContain('experience');
    expect(Array.isArray(SECTION_IDS)).toBe(true);
  });
});
