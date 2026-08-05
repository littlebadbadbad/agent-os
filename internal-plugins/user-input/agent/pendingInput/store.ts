/**
 * internal-plugins/user-input/agent/pendingInput/store.ts — PendingInputStore factory
 *
 * Per-scope queue store for in-flight pending input entries.
 * Keyed by sessionId.
 *
 * Ported from src/tools/pendingInput/store.ts with full TypeScript typing.
 */

import type { PendingInputEntry } from "./types";

// ── Bucket ────────────────────────────────────────────────────────────────────

interface Bucket {
  queue: PendingInputEntry[];
  /** Bound to `session.sendMessage` once `onSessionReady` fires. */
  sendMessage: ((text: string) => void) | undefined;
  subs: Set<() => void>;
}

// ── Store API ─────────────────────────────────────────────────────────────────

export interface PendingInputStore {
  enqueue(key: string, entry: PendingInputEntry): void;
  cancel(key: string, id: string): void;
  getQueue(key: string): readonly PendingInputEntry[];
  drainForInvoke(key: string): readonly PendingInputEntry[];
  resume(key: string): void;
  setSendMessage(key: string, fn: (text: string) => void): void;
  reset(key: string): void;
  remove(key: string): void;
  subscribe(key: string, fn: () => void): () => void;
  serialize(key: string): readonly PendingInputEntry[] | undefined;
  restore(key: string, entries: readonly PendingInputEntry[]): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPendingInputStore(): PendingInputStore {
  const buckets = new Map<string, Bucket>();

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

  return {
    [Symbol('buckets')]: buckets,
    enqueue(key: string, entry: PendingInputEntry): void {
      const b = getOrCreate(key);
      b.queue.push(entry);
      notify(b);
    },

    cancel(key: string, id: string): void {
      const b = buckets.get(key);
      if (!b) return;
      const idx = b.queue.findIndex((e) => e.id === id);
      if (idx === -1) return;
      b.queue.splice(idx, 1);
      notify(b);
    },

    getQueue(key: string): readonly PendingInputEntry[] {
      return buckets.get(key)?.queue ?? [];
    },

    drainForInvoke(key: string): readonly PendingInputEntry[] {
      const b = buckets.get(key);
      if (!b?.queue.length) return [];
      const toInject = [...b.queue];
      b.queue = [];
      notify(b);
      return toInject;
    },

    resume(key: string): void {
      const b = buckets.get(key);
      if (!b?.queue.length) return;
      const [first, ...rest] = b.queue;
      b.queue = rest;
      notify(b);
      b.sendMessage?.(first.text);
    },

    setSendMessage(key: string, fn: (text: string) => void): void {
      getOrCreate(key).sendMessage = fn;
    },

    reset(key: string): void {
      const b = buckets.get(key);
      if (!b) return;
      b.queue = [];
      notify(b);
    },

    remove(key: string): void {
      buckets.delete(key);
    },

    subscribe(key: string, fn: () => void): () => void {
      const b = getOrCreate(key);
      b.subs.add(fn);
      return () => {
        b.subs.delete(fn);
      };
    },

    serialize(key: string): readonly PendingInputEntry[] | undefined {
      const q = buckets.get(key)?.queue;
      return q?.length ? [...q] : undefined;
    },

    restore(key: string, entries: readonly PendingInputEntry[]): void {
      const b = getOrCreate(key);
      b.queue = [...entries];
      notify(b);
    },
  };
}
