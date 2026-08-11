/**
 * internal-apps/terminal/agent/upgrade/store.ts — In-memory upgrade state bucket
 *
 * One bucket per context key (sessionId:agentName:conversationId).
 * Lightweight key-value store with subscriber notification.
 */

import type { VersionInfo } from "./types";

// ── Bucket shape ───────────────────────────────────────────────────────────

interface Bucket {
  version: VersionInfo | undefined;
  restartPending: boolean;
  devUrl: string | undefined;
  devTerminalId: string | undefined;
  devRunning: boolean;
  frozen: boolean;
  subs: Set<() => void>;
}

// ── Internal registry ──────────────────────────────────────────────────────

const buckets = new Map<string, Bucket>();

function getOrCreate(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = {
      version: undefined,
      restartPending: false,
      devUrl: undefined,
      devTerminalId: undefined,
      devRunning: false,
      frozen: false,
      subs: new Set(),
    };
    buckets.set(key, b);
  }
  return b;
}

function notify(key: string): void {
  buckets.get(key)?.subs.forEach((fn) => fn());
}

// ── Public API ─────────────────────────────────────────────────────────────

export const upgradeStore = {
  get(key: string): Bucket | undefined {
    return buckets.get(key);
  },

  setVersion(key: string, version: VersionInfo): void {
    getOrCreate(key).version = version;
    notify(key);
  },

  setRestartPending(key: string, pending: boolean): void {
    getOrCreate(key).restartPending = pending;
    // Not UI-visible — no notify.
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

  setDevState(
    key: string,
    url: string | undefined,
    running: boolean,
    terminalId?: string,
  ): void {
    const b = getOrCreate(key);
    b.devUrl = url;
    b.devTerminalId = terminalId;
    b.devRunning = running;
    notify(key);
  },

  setFrozen(key: string, frozen: boolean): void {
    getOrCreate(key).frozen = frozen;
    // Not UI-visible — no notify.
  },
};
