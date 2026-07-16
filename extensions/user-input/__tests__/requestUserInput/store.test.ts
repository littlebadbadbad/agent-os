// @ts-nocheck
/**
 * extensions/user-input/__tests__/requestUserInput/store.test.ts
 *
 * Full coverage for createUserInputStore.
 * Tests every method including edge cases and empty states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUserInputStore } from '../../agent/requestUserInput/store';
import type { InlinePromptEntry, InlinePromptEntryInternal } from '../../agent/requestUserInput/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

function makeEntry(overrides: Partial<InlinePromptEntryInternal> = {}): InlinePromptEntryInternal {
  return {
    id: 'e1',
    kind: 'text',
    message: 'Enter value:',
    toolCallId: 'tc-1',
    toolName: 'ask_user',
    conversationId: 'main',
    agentName: 'main',
    resolve: vi.fn(),
    ...overrides,
  };
}

function makePrompt(overrides: Partial<InlinePromptEntry> = {}): InlinePromptEntry {
  return {
    id: 'ghost-1',
    kind: 'confirm',
    message: 'Proceed?',
    toolCallId: 'ghost-tc',
    toolName: 'ask_user',
    conversationId: 'main',
    agentName: 'main',
    ...overrides,
  };
}

describe('createUserInputStore', () => {
  let store: ReturnType<typeof createUserInputStore>;

  beforeEach(() => {
    store = createUserInputStore();
  });

  // ── add / getAll ──────────────────────────────────────────────────────────

  describe('add / getAll', () => {
    it('returns empty array for unknown session', () => {
      expect(store.getAll(SESSION_A)).toEqual([]);
    });

    it('adds a single entry and exposes it via getAll (without resolve)', () => {
      store.add(SESSION_A, makeEntry({ id: 'e1', message: 'Hello' }));
      const all = store.getAll(SESSION_A);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('e1');
      expect(all[0].message).toBe('Hello');
      expect((all[0] as Record<string, unknown>).resolve).toBeUndefined();
    });

    it('adds multiple entries in insertion order', () => {
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      store.add(SESSION_A, makeEntry({ id: 'e2' }));
      store.add(SESSION_A, makeEntry({ id: 'e3' }));
      const all = store.getAll(SESSION_A);
      expect(all.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    });

    it('isolates entries per session', () => {
      store.add(SESSION_A, makeEntry({ id: 'a1' }));
      store.add(SESSION_B, makeEntry({ id: 'b1' }));
      expect(store.getAll(SESSION_A)).toHaveLength(1);
      expect(store.getAll(SESSION_B)).toHaveLength(1);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes an entry and calls its resolve callback', () => {
      const resolve = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve }));
      store.remove(SESSION_A, 'e1', 'answer');
      expect(resolve).toHaveBeenCalledWith('answer');
      expect(store.getAll(SESSION_A)).toHaveLength(0);
    });

    it('does nothing for non-existent id', () => {
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      store.remove(SESSION_A, 'unknown', 'val');
      expect(store.getAll(SESSION_A)).toHaveLength(1);
    });

    it('does nothing for unknown session', () => {
      expect(() => store.remove(SESSION_A, 'x', 'v')).not.toThrow();
    });

    it('calls resolve with null on cancel', () => {
      const resolve = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve }));
      store.remove(SESSION_A, 'e1', null);
      expect(resolve).toHaveBeenCalledWith(null);
    });
  });

  // ── getResponder ──────────────────────────────────────────────────────────

  describe('getResponder', () => {
    it('returns a stable closure (same reference on second call)', () => {
      const a = store.getResponder(SESSION_A);
      const b = store.getResponder(SESSION_A);
      expect(a).toBe(b);
    });

    it('returns different closures for different sessions', () => {
      const a = store.getResponder(SESSION_A);
      const b = store.getResponder(SESSION_B);
      expect(a).not.toBe(b);
    });

    it('removes the entry and calls resolve with the value', () => {
      const resolve = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve }));
      store.getResponder(SESSION_A)('e1', 'response');
      expect(resolve).toHaveBeenCalledWith('response');
      expect(store.getAll(SESSION_A)).toHaveLength(0);
    });

    it('does nothing for non-existent entry', () => {
      expect(() => store.getResponder(SESSION_A)('unknown', 'v')).not.toThrow();
    });
  });

  // ── subscribe ─────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('notifies subscribers on add', () => {
      const fn = vi.fn();
      store.subscribe(SESSION_A, fn);
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      expect(fn).toHaveBeenCalledOnce();
    });

    it('notifies subscribers on remove', () => {
      const fn = vi.fn();
      store.subscribe(SESSION_A, fn);
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      fn.mockClear();
      store.remove(SESSION_A, 'e1', 'v');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('unsubscribe stops notifications', () => {
      const fn = vi.fn();
      const unsub = store.subscribe(SESSION_A, fn);
      unsub();
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // ── removeSession / resetSession ──────────────────────────────────────────

  describe('removeSession', () => {
    it('resolves all pending entries and clears the bucket', () => {
      const r1 = vi.fn();
      const r2 = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve: r1 }));
      store.add(SESSION_A, makeEntry({ id: 'e2', resolve: r2 }));
      store.removeSession(SESSION_A);
      expect(r1).toHaveBeenCalledWith(null);
      expect(r2).toHaveBeenCalledWith(null);
      expect(store.getAll(SESSION_A)).toHaveLength(0);
    });

    it('does nothing for unknown session', () => {
      expect(() => store.removeSession('unknown')).not.toThrow();
    });
  });

  describe('resetSession', () => {
    it('resolves all pending entries and clears entries', () => {
      const r1 = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve: r1 }));
      store.resetSession(SESSION_A);
      expect(r1).toHaveBeenCalledWith(null);
      expect(store.getAll(SESSION_A)).toHaveLength(0);
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.subscribe(SESSION_A, fn);
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      fn.mockClear();
      store.resetSession(SESSION_A);
      expect(fn).toHaveBeenCalled();
    });
  });

  // ── serialize ─────────────────────────────────────────────────────────────

  describe('serialize', () => {
    it('returns all entries when none are ephemeral', () => {
      store.add(SESSION_A, makeEntry({ id: 'e1', message: 'm1' }));
      store.add(SESSION_A, makeEntry({ id: 'e2', message: 'm2' }));
      const s = store.serialize(SESSION_A);
      expect(s).toHaveLength(2);
      expect(s.map((e) => e.id)).toEqual(['e1', 'e2']);
    });

    it('skips ephemeral entries', () => {
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      store.add(SESSION_A, makeEntry({ id: 'e2', ephemeral: true }));
      const s = store.serialize(SESSION_A);
      expect(s).toHaveLength(1);
      expect(s[0].id).toBe('e1');
    });

    it('returns empty array for unknown session', () => {
      expect(store.serialize('unknown')).toEqual([]);
    });

    it('strips resolve from serialized entries', () => {
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      const s = store.serialize(SESSION_A);
      expect((s[0] as Record<string, unknown>).resolve).toBeUndefined();
    });
  });

  // ── addGhost ──────────────────────────────────────────────────────────────

  describe('addGhost', () => {
    it('adds an entry with a custom resolve callback', () => {
      const ghostResolve = vi.fn();
      store.addGhost(SESSION_A, makePrompt({ id: 'g1' }), ghostResolve);
      expect(store.getAll(SESSION_A)).toHaveLength(1);
      expect(store.getAll(SESSION_A)[0].id).toBe('g1');
      store.remove(SESSION_A, 'g1', 'val');
      expect(ghostResolve).toHaveBeenCalledWith('val');
    });
  });

  // ── replaceResolve ────────────────────────────────────────────────────────

  describe('replaceResolve', () => {
    it('replaces the resolve callback for an existing entry', () => {
      const originalResolve = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve: originalResolve }));
      const newResolve = vi.fn();
      store.replaceResolve(SESSION_A, 'e1', newResolve);
      store.remove(SESSION_A, 'e1', 'new-val');
      // Original resolve should NOT have been called
      expect(originalResolve).not.toHaveBeenCalled();
      // New resolve should have been called
      expect(newResolve).toHaveBeenCalledWith('new-val');
    });

    it('does nothing for non-existent entry', () => {
      expect(() => store.replaceResolve(SESSION_A, 'missing', vi.fn())).not.toThrow();
    });

    it('does nothing for unknown session', () => {
      expect(() => store.replaceResolve('unknown', 'x', vi.fn())).not.toThrow();
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.subscribe(SESSION_A, fn);
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      fn.mockClear();
      store.replaceResolve(SESSION_A, 'e1', vi.fn());
      expect(fn).toHaveBeenCalled();
    });
  });

  // ── cancelAll ────────────────────────────────────────────────────────────

  describe('cancelAll', () => {
    it('resolves all pending entries with null and clears them', () => {
      const r1 = vi.fn();
      const r2 = vi.fn();
      store.add(SESSION_A, makeEntry({ id: 'e1', resolve: r1 }));
      store.add(SESSION_A, makeEntry({ id: 'e2', resolve: r2 }));
      store.cancelAll(SESSION_A);
      expect(r1).toHaveBeenCalledWith(null);
      expect(r2).toHaveBeenCalledWith(null);
      expect(store.getAll(SESSION_A)).toHaveLength(0);
    });

    it('does nothing for unknown session', () => {
      expect(() => store.cancelAll('unknown')).not.toThrow();
    });

    it('does nothing when no entries exist', () => {
      expect(() => store.cancelAll(SESSION_A)).not.toThrow();
    });

    it('notifies subscribers', () => {
      const fn = vi.fn();
      store.subscribe(SESSION_A, fn);
      store.add(SESSION_A, makeEntry({ id: 'e1' }));
      fn.mockClear();
      store.cancelAll(SESSION_A);
      expect(fn).toHaveBeenCalled();
    });
  });
});
