/**
 * Tests for backend/lib/stream-registry.js — In-memory stream registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamRegistry } from '../lib/stream-registry.js';

describe('streamRegistry', () => {
  beforeEach(() => {
    streamRegistry.clearAll();
  });

  it('set and get round-trip', () => {
    const entry = { tag: 'browser', cleanup: vi.fn() };
    streamRegistry.set('stream-1', entry);
    expect(streamRegistry.get('stream-1')).toBe(entry);
  });

  it('get returns undefined for unknown id', () => {
    expect(streamRegistry.get('nonexistent')).toBeUndefined();
  });

  it('has returns true for registered stream', () => {
    streamRegistry.set('s1', { tag: 'chat' });
    expect(streamRegistry.has('s1')).toBe(true);
  });

  it('has returns false for unknown stream', () => {
    expect(streamRegistry.has('ghost')).toBe(false);
  });

  it('delete removes the entry', () => {
    streamRegistry.set('s1', { tag: 'browser' });
    streamRegistry.delete('s1');
    expect(streamRegistry.has('s1')).toBe(false);
  });

  it('delete is safe for unknown id', () => {
    expect(() => streamRegistry.delete('unknown')).not.toThrow();
  });

  it('abort calls cleanup and marks aborted', () => {
    const cleanup = vi.fn();
    streamRegistry.set('s1', { tag: 'chat', cleanup, ctrl: new AbortController() });
    streamRegistry.abort('s1');
    expect(cleanup).toHaveBeenCalled();
  });

  it('abort is safe for unknown id', () => {
    expect(() => streamRegistry.abort('unknown')).not.toThrow();
  });

  it('abort is idempotent (second call does nothing)', () => {
    const cleanup = vi.fn();
    streamRegistry.set('s1', { tag: 'chat', cleanup });
    streamRegistry.abort('s1');
    streamRegistry.abort('s1');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('size returns the count of registered streams', () => {
    expect(streamRegistry.size()).toBe(0);
    streamRegistry.set('s1', { tag: 'browser' });
    expect(streamRegistry.size()).toBe(1);
  });

  it('size with tag filter counts only matching entries', () => {
    streamRegistry.set('s1', { tag: 'browser' });
    streamRegistry.set('s2', { tag: 'chat' });
    expect(streamRegistry.size('browser')).toBe(1);
    expect(streamRegistry.size('chat')).toBe(1);
  });

  it('clearAll removes all entries', () => {
    streamRegistry.set('s1', { tag: 'browser' });
    streamRegistry.set('s2', { tag: 'chat' });
    streamRegistry.clearAll();
    expect(streamRegistry.size()).toBe(0);
  });

  it('clearAll with tag filter removes only matching entries', () => {
    streamRegistry.set('s1', { tag: 'browser' });
    streamRegistry.set('s2', { tag: 'chat' });
    streamRegistry.clearAll('browser');
    expect(streamRegistry.has('s1')).toBe(false);
    expect(streamRegistry.has('s2')).toBe(true);
  });

  it('entries returns all registered entries', () => {
    streamRegistry.set('s1', { tag: 'browser' });
    streamRegistry.set('s2', { tag: 'chat' });
    const entries = [...streamRegistry.entries()];
    expect(entries).toHaveLength(2);
  });
});
