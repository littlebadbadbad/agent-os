// ── Cron frontend store ───────────────────────────────────────────────────────
//
// Per-session job list storage. Keyed by sessionId.
// Does NOT contain the scheduler — that lives in the backend.
// The `stopListening` function (returned by adapter.startListening) is stored
// here so it can be called on session removal.

import type { CronJob } from './types';

type Bucket = {
  jobs: CronJob[];
  stopListening?: () => void;
  subs: Set<() => void>;
};

const buckets = new Map<string, Bucket>();

function getOrCreate(sessionId: string): Bucket {
  let b = buckets.get(sessionId);
  if (!b) {
    b = { jobs: [], subs: new Set() };
    buckets.set(sessionId, b);
  }
  return b;
}

function notify(sessionId: string): void {
  buckets.get(sessionId)?.subs.forEach((fn) => fn());
}

export const cronStore = {
  getJobs(sessionId: string): CronJob[] {
    return buckets.get(sessionId)?.jobs ?? [];
  },

  setJobs(sessionId: string, jobs: CronJob[]): void {
    getOrCreate(sessionId).jobs = jobs;
    notify(sessionId);
  },

  updateJob(sessionId: string, updated: CronJob): void {
    const b = getOrCreate(sessionId);
    const idx = b.jobs.findIndex((j) => j.id === updated.id);
    if (idx !== -1) {
      b.jobs = [...b.jobs.slice(0, idx), updated, ...b.jobs.slice(idx + 1)];
    } else {
      b.jobs = [...b.jobs, updated];
    }
    notify(sessionId);
  },

  removeJob(sessionId: string, id: string): void {
    const b = buckets.get(sessionId);
    if (b) {
      b.jobs = b.jobs.filter((j) => j.id !== id);
      notify(sessionId);
    }
  },

  setStopListening(sessionId: string, fn: () => void): void {
    getOrCreate(sessionId).stopListening = fn;
  },

  stopListening(sessionId: string): void {
    buckets.get(sessionId)?.stopListening?.();
  },

  reset(sessionId: string): void {
    const b = buckets.get(sessionId);
    if (b) {
      b.jobs = [];
      notify(sessionId);
    }
  },

  remove(sessionId: string): void {
    buckets.delete(sessionId);
  },

  subscribe(sessionId: string, fn: () => void): () => void {
    const b = getOrCreate(sessionId);
    b.subs.add(fn);
    return () => b.subs.delete(fn);
  },
};
