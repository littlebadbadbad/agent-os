import type { PendingInputEntry } from './types';

// ── Bucket ────────────────────────────────────────────────────────────────────

type Bucket = {
  queue: PendingInputEntry[];
  /** Bound to `session.sendMessage` once `onSessionReady` fires. */
  sendMessage: ((text: string) => void) | undefined;
  subs: Set<() => void>;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Per-scope queue store for in-flight pending input entries.
 *
 * Keyed by `toolSetContextKey(ctx)` (sessionId for the main agent,
 * "sessionId:agentName" for sub-agents).
 */
export function createPendingInputStore() {
  const buckets = new Map<string, Bucket>();

  // ── Internals ─────────────────────────────────────────────────────────────

  function getOrCreate(key: string): Bucket {
    let b = buckets.get(key);
    if (!b) {
      b = { queue: [], sendMessage: undefined, subs: new Set() };
      buckets.set(key, b);
    }
    return b;
  }

  function notify(b: Bucket): void {
    for (const fn of b.subs) fn();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    /** Add a new entry to the tail of the queue. */
    enqueue(key: string, entry: PendingInputEntry): void {
      const b = getOrCreate(key);
      b.queue.push(entry);
      notify(b);
    },

    /** Remove a specific entry by ID (user cancelled it). */
    cancel(key: string, id: string): void {
      const b = buckets.get(key);
      if (!b) return;
      const idx = b.queue.findIndex((e) => e.id === id);
      if (idx === -1) return;
      b.queue.splice(idx, 1);
      notify(b);
    },

    /** Snapshot of the current queue (in order). */
    getQueue(key: string): readonly PendingInputEntry[] {
      return buckets.get(key)?.queue ?? [];
    },

    /**
     * Drain the entire queue and return all entries.
     *
     * Called by `onBeforeInvoke` to inject ALL queued user messages into the
     * LLM history at once before the next handler call.
     *
     * UI injection is handled by `agentSession` after receiving the returned
     * entries via the `onBeforeInvoke` hook — no subscriber notification needed.
     */
    drainForInvoke(key: string): readonly PendingInputEntry[] {
      const b = buckets.get(key);
      if (!b?.queue.length) return [];
      const toInject = [...b.queue];
      b.queue = [];
      return toInject;
    },

    /**
     * Send the first queued entry as a new agent run.
     *
     * Dispatches the first entry via `sendMessage`; the remaining entries stay
     * in the queue and are all drained together by `drainForInvoke` on the
     * first turn of the new run.
     *
     * No-ops when the queue is empty or `sendMessage` is not yet bound.
     */
    resume(key: string): void {
      const b = buckets.get(key);
      if (!b?.queue.length) return;
      const [first, ...rest] = b.queue;
      b.queue = rest;
      notify(b);
      b.sendMessage?.(first.text);
    },

    /** Bind the session's sendMessage function (called from onSessionReady). */
    setSendMessage(key: string, fn: (text: string) => void): void {
      getOrCreate(key).sendMessage = fn;
    },

    /** Empty the queue (session cleared). */
    reset(key: string): void {
      const b = buckets.get(key);
      if (!b) return;
      b.queue = [];
      notify(b);
    },

    /** Discard the bucket entirely (session removed). */
    remove(key: string): void {
      buckets.delete(key);
    },

    /** Subscribe to queue changes.  Returns an unsubscribe function. */
    subscribe(key: string, fn: () => void): () => void {
      const b = getOrCreate(key);
      b.subs.add(fn);
      return () => b.subs.delete(fn);
    },

    /** Serialize the queue for persistence (undefined when empty). */
    serialize(key: string): readonly PendingInputEntry[] | undefined {
      const q = buckets.get(key)?.queue;
      return q?.length ? [...q] : undefined;
    },

    /**
     * Restore a previously persisted queue (page reload).
     *
     * The UI exposes a "Continue" button so the user can review and decide
     * before the next run starts.
     */
    restore(key: string, entries: PendingInputEntry[]): void {
      if (entries.length) getOrCreate(key).queue = [...entries];
    },
  };
}

export type PendingInputStore = ReturnType<typeof createPendingInputStore>;
