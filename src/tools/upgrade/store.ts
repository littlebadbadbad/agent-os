import type { VersionInfo } from './adapter';

// ── Bucket ────────────────────────────────────────────────────────────────────

type Bucket = {
  version: VersionInfo | undefined;
  restartPending: boolean;
  devUrl: string | undefined;
  devTerminalId: string | undefined;
  devRunning: boolean;
  frozen: boolean;
  subs: Set<() => void>;
};

const buckets = new Map<string, Bucket>();

function getOrCreate(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { version: undefined, restartPending: false, devUrl: undefined, devTerminalId: undefined, devRunning: false, frozen: false, subs: new Set() };
    buckets.set(key, b);
  }
  return b;
}

function notify(key: string): void {
  buckets.get(key)?.subs.forEach((fn) => fn());
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const upgradeStore = {
  get(key: string): Bucket | undefined {
    return buckets.get(key);
  },

  setVersion(key: string, version: VersionInfo): void {
    getOrCreate(key).version = version;
    notify(key);
  },

  /** Mark or unmark the fallback-path restart-pending flag. */
  setRestartPending(key: string, pending: boolean): void {
    getOrCreate(key).restartPending = pending;
    // No notify — restartPending is not a UI-visible state field.
  },

  remove(key: string): void {
    buckets.delete(key);
  },

  subscribe(key: string, fn: () => void): () => void {
    const b = getOrCreate(key);
    b.subs.add(fn);
    return () => b.subs.delete(fn);
  },

  setDevState(key: string, url: string | undefined, running: boolean, terminalId?: string): void {
    const b = getOrCreate(key);
    b.devUrl = url;
    b.devTerminalId = terminalId;
    b.devRunning = running;
    notify(key);
  },

  setFrozen(key: string, frozen: boolean): void {
    getOrCreate(key).frozen = frozen;
    // frozen is not a UI-visible state field — no notify needed.
  },
};
