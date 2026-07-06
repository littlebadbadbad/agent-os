/**
 * extensions/user-input/agent/store.ts — UserInputStore factory
 *
 * In-memory store keyed by sessionId. Each bucket holds a Map of
 * pending prompt entries (with Promise resolve callbacks) and
 * a Set of React-compatible subscribers.
 *
 * Ported from plugins/user-input/index.js with full TypeScript typing.
 */

import type {
  UserInputStore,
  UserInputBucket,
  InlinePromptEntry,
  InlinePromptEntryInternal,
} from "./types";

export function createUserInputStore(): UserInputStore {
  const buckets = new Map<string, UserInputBucket>();

  function getOrCreate(sessionId: string): UserInputBucket {
    let b = buckets.get(sessionId);
    if (!b) {
      b = {
        entries: new Map(),
        subs: new Set(),
        responder: undefined,
      };
      buckets.set(sessionId, b);
    }
    return b;
  }

  function notify(bucket: UserInputBucket): void {
    for (const fn of bucket.subs) fn();
  }

  return {
    add(sessionId: string, entry: InlinePromptEntryInternal): void {
      const b = getOrCreate(sessionId);
      b.entries.set(entry.id, entry);
      notify(b);
    },

    remove(
      sessionId: string,
      id: string,
      value: string | null,
    ): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      const entry = b.entries.get(id);
      if (!entry) return;
      b.entries.delete(id);
      entry.resolve(value);
      notify(b);
    },

    getAll(sessionId: string): readonly InlinePromptEntry[] {
      const b = buckets.get(sessionId);
      if (!b) return [];
      // Strip the internal `resolve` field before exposing to UI.
      return [...b.entries.values()].map(
        ({ resolve: _r, ...rest }: InlinePromptEntryInternal) => rest,
      );
    },

    getResponder(
      sessionId: string,
    ): (id: string, value: string | null) => void {
      const b = getOrCreate(sessionId);
      if (!b.responder) {
        b.responder = (id: string, value: string | null) => {
          const entry = b.entries.get(id);
          if (!entry) return;
          b.entries.delete(id);
          entry.resolve(value);
          notify(b);
        };
      }
      return b.responder;
    },

    subscribe(sessionId: string, fn: () => void): () => void {
      const b = getOrCreate(sessionId);
      b.subs.add(fn);
      return () => {
        b.subs.delete(fn);
      };
    },

    removeSession(sessionId: string): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      for (const entry of b.entries.values()) entry.resolve(null);
      buckets.delete(sessionId);
    },

    resetSession(sessionId: string): void {
      const b = buckets.get(sessionId);
      if (!b) return;
      for (const entry of b.entries.values()) entry.resolve(null);
      b.entries.clear();
      notify(b);
    },

    serialize(sessionId: string): readonly InlinePromptEntry[] {
      const b = buckets.get(sessionId);
      if (!b) return [];
      // Only persist non-ephemeral entries.
      const result: InlinePromptEntry[] = [];
      for (const entry of b.entries.values()) {
        if ("ephemeral" in entry && entry.ephemeral) continue;
        const { resolve: _r, ...rest } = entry as InlinePromptEntryInternal;
        result.push(rest);
      }
      return result;
    },

    addGhost(
      sessionId: string,
      prompt: InlinePromptEntry,
      onResolve: (value: string | null) => void,
    ): void {
      const b = getOrCreate(sessionId);
      b.entries.set(prompt.id, { ...prompt, resolve: onResolve });
      notify(b);
    },
  };
}
