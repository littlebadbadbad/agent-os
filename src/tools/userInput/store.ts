import type { PendingUserInput, PendingEntry } from './types';

// ── Session bucket ────────────────────────────────────────────────────────────

type SessionBucket = {
  entries: Map<string, PendingEntry>;
  subs: Set<() => void>;
  // Stable per-session responder — created once, never replaced.
  responder: ((id: string, value: string | null) => void) | undefined;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Session-keyed flat store for in-flight user-input requests.
 *
 * Keyed by `sessionId` (not `toolSetContextKey`) so that all conversations
 * within a session — main agent and every sub-agent — share one bucket and
 * all surface their pending inputs in the same UI list.
 */
export function createUserInputStore() {
  const buckets = new Map<string, SessionBucket>();

  // ── Internals ───────────────────────────────────────────────────────────

  function getOrCreate(sessionId: string): SessionBucket {
    let b = buckets.get(sessionId);
    if (!b) {
      b = { entries: new Map(), subs: new Set(), responder: undefined };
      buckets.set(sessionId, b);
    }
    return b;
  }

  function notify(bucket: SessionBucket): void {
    for (const fn of bucket.subs) fn();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  const store = {
    add(sessionId: string, entry: PendingEntry): void {
      const b = getOrCreate(sessionId);
      b.entries.set(entry.id, entry);
      notify(b);
    },

    remove(sessionId: string, id: string, value: string | null): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      const entry = b.entries.get(id);
      if (!entry) return;
      b.entries.delete(id);
      entry.resolve(value);
      notify(b);
    },

    getAll(sessionId: string): readonly PendingUserInput[] {
      const b = buckets.get(sessionId);
      if (!b) return [];
      return [...b.entries.values()].map(({ resolve: _r, ...rest }): PendingUserInput => rest);
    },

    /**
     * Returns a stable `(id, value) => void` function for this session.
     * Created on first call and reused — safe to store as a state value.
     */
    getResponder(sessionId: string): (id: string, value: string | null) => void {
      const b = getOrCreate(sessionId);
      if (!b.responder) {
        b.responder = (id, value) => store.remove(sessionId, id, value);
      }
      return b.responder;
    },

    subscribe(sessionId: string, fn: () => void): () => void {
      const b = getOrCreate(sessionId);
      b.subs.add(fn);
      return () => b.subs.delete(fn);
    },

    /** Resolve all pending entries with `null` and tear down the bucket. */
    removeSession(sessionId: string): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      for (const entry of b.entries.values()) entry.resolve(null);
      buckets.delete(sessionId);
    },

    /** Resolve all pending entries with `null` and reset to an empty bucket. */
    resetSession(sessionId: string): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      for (const entry of b.entries.values()) entry.resolve(null);
      b.entries.clear();
      notify(b);
    },

    /**
     * Returns all non-ephemeral entries as plain `PendingUserInput` values
     * suitable for JSON serialization and storage in `SessionEntryData`.
     */
    serialize(sessionId: string): readonly PendingUserInput[] {
      const b = buckets.get(sessionId);
      if (!b) return [];
      return [...b.entries.values()]
        .filter((e) => !e.request.ephemeral)
        .map(({ resolve: _r, ...rest }): PendingUserInput => rest);
    },

    /**
     * Restore a persisted entry with a caller-supplied resolve function.
     * Used during ghost restore in `onInitSession` / `onSessionReady`.
     */
    addGhost(
      sessionId: string,
      saved: PendingUserInput,
      resolve: (v: string | null) => void,
    ): void {
      const b = getOrCreate(sessionId);
      b.entries.set(saved.id, { ...saved, resolve });
      notify(b);
    },

    /** Update the resolve function of an existing ghost entry in-place. */
    patchGhostResolve(
      sessionId: string,
      id: string,
      resolve: (v: string | null) => void,
    ): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      const entry = b.entries.get(id);
      if (!entry) return;
      b.entries.set(id, { ...entry, resolve });
    },
  };

  return store;
}

export type UserInputStore = ReturnType<typeof createUserInputStore>;
