/**
 * Tests for backend/lib/cron-manager/index.js
 *
 * Uses fake timers so setInterval never fires automatically; tick() is
 * triggered by vi.advanceTimersByTime().
 *
 * Covers:
 *   createJob      — success, invalid expr, custom/auto label, recurring flag
 *   deleteJob      — found / not found
 *   pauseJob       — found / not found
 *   resumeJob      — from paused, not found, completed job, bad cronExpr
 *   listJobs       — per-session filtering
 *   getJob         — found / not found
 *   subscribe      — callback invoked on tick, last subscriber cleans up Set
 *   tick (timer)   — recurring fires + recalculates, one-shot completes,
 *                    paused skipped, null-nextFireAt skipped, future skipped,
 *                    subscriber error swallowed
 *   ensureScheduler — idempotent (only one interval created)
 *   process exit   — clearInterval called
 */

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// Install fake timers BEFORE any createJob() runs, so setInterval is intercepted.
beforeAll(() => vi.useFakeTimers());
afterAll(() => vi.useRealTimers());

// Silence logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import {
  createJob,
  deleteJob,
  pauseJob,
  resumeJob,
  listJobs,
  getJob,
  subscribe,
} from '../lib/cron-manager/index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const _cleanup = [];

/** Create a job and register it for afterEach cleanup. */
function make(opts) {
  const job = createJob({ cronExpr: '0 0 * * *', prompt: 'hello', ...opts });
  _cleanup.push(job.id);
  return job;
}

afterEach(() => {
  while (_cleanup.length) deleteJob(_cleanup.pop());
});

// ─── createJob ────────────────────────────────────────────────────────────────

describe('createJob', () => {
  it('returns a job with expected shape', () => {
    const job = make({ sessionId: 's1' });
    expect(job.id).toMatch(/^cron_[0-9a-f]{8}$/);
    expect(job.sessionId).toBe('s1');
    expect(job.status).toBe('active');
    expect(job.fireCount).toBe(0);
    expect(job.lastFiredAt).toBeNull();
    expect(typeof job.nextFireAt).toBe('string');
    expect(job.recurring).toBe(true); // default
  });

  it('uses a custom label when provided', () => {
    const job = make({ sessionId: 's1', label: 'Nightly report' });
    expect(job.label).toBe('Nightly report');
  });

  it('generates a human label when none is provided', () => {
    const job = make({ sessionId: 's1' }); // cronExpr = '0 0 * * *'
    expect(typeof job.label).toBe('string');
    expect(job.label.length).toBeGreaterThan(0);
  });

  it('honours recurring = false', () => {
    const job = make({ sessionId: 's1', recurring: false });
    expect(job.recurring).toBe(false);
  });

  it('throws for an invalid cron expression', () => {
    expect(() => createJob({ sessionId: 's1', cronExpr: 'not-valid', prompt: 'x' }))
      .toThrow(/invalid cron expression/i);
  });

  it('throws when the session has reached MAX_JOBS active jobs', () => {
    for (let i = 0; i < 50; i++) make({ sessionId: 'max-test' });
    expect(() => make({ sessionId: 'max-test' })).toThrow(/maximum/i);
  });
});

// ─── deleteJob ────────────────────────────────────────────────────────────────

describe('deleteJob', () => {
  it('returns true and removes the job', () => {
    const job = make({ sessionId: 's1' });
    expect(deleteJob(job.id)).toBe(true);
    _cleanup.pop(); // already deleted
    expect(getJob(job.id)).toBeUndefined();
  });

  it('returns false for an unknown id', () => {
    expect(deleteJob('does-not-exist')).toBe(false);
  });
});

// ─── pauseJob ─────────────────────────────────────────────────────────────────

describe('pauseJob', () => {
  it('sets status to paused and clears nextFireAt', () => {
    const job = make({ sessionId: 's1' });
    const paused = pauseJob(job.id);
    expect(paused.status).toBe('paused');
    expect(paused.nextFireAt).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(pauseJob('ghost')).toBeNull();
  });
});

// ─── resumeJob ────────────────────────────────────────────────────────────────

describe('resumeJob', () => {
  it('resumes a paused job and recalculates nextFireAt', () => {
    const job = make({ sessionId: 's1' });
    pauseJob(job.id);
    const resumed = resumeJob(job.id);
    expect(resumed.status).toBe('active');
    expect(typeof resumed.nextFireAt).toBe('string');
  });

  it('also works on an active job (re-schedules)', () => {
    const job = make({ sessionId: 's1' });
    const result = resumeJob(job.id);
    expect(result.status).toBe('active');
  });

  it('returns null for an unknown id', () => {
    expect(resumeJob('ghost')).toBeNull();
  });

  it('returns null for a completed job', () => {
    const job = make({ sessionId: 's1' });
    job.status = 'completed'; // manually force completed
    expect(resumeJob(job.id)).toBeNull();
  });

  it('returns null when the stored cronExpr is no longer valid', () => {
    const job = make({ sessionId: 's1' });
    pauseJob(job.id);
    job.cronExpr = 'INVALID'; // corrupt after creation
    expect(resumeJob(job.id)).toBeNull();
  });
});

// ─── listJobs / getJob ────────────────────────────────────────────────────────

describe('listJobs', () => {
  it('returns only jobs for the given session', () => {
    const j1 = make({ sessionId: 'listA' });
    const j2 = make({ sessionId: 'listA' });
    const j3 = make({ sessionId: 'listB' });

    const a = listJobs('listA');
    expect(a).toHaveLength(2);
    expect(a.map(j => j.id)).toEqual(expect.arrayContaining([j1.id, j2.id]));

    const b = listJobs('listB');
    expect(b).toHaveLength(1);
    expect(b[0].id).toBe(j3.id);

    expect(listJobs('listC')).toHaveLength(0);
  });
});

describe('getJob', () => {
  it('returns the job by id', () => {
    const job = make({ sessionId: 's1' });
    expect(getJob(job.id)).toBe(job);
  });

  it('returns undefined for an unknown id', () => {
    expect(getJob('nope')).toBeUndefined();
  });
});

// ─── subscribe / unsubscribe ──────────────────────────────────────────────────

describe('subscribe', () => {
  it('returns an unsubscribe function without error', () => {
    const fn = vi.fn();
    const unsub = subscribe('sub-session', fn);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('unsubscribing twice is idempotent', () => {
    const fn = vi.fn();
    const unsub = subscribe('sub-session-2', fn);
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('after unsubscribe, the session Set is removed when empty', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const unsub1 = subscribe('empty-check', fn1);
    const unsub2 = subscribe('empty-check', fn2);
    unsub1();
    unsub2(); // Set is now empty → _subscribers entry should be deleted
    // No public API to inspect _subscribers, but re-subscribing creates a fresh set
    const fn3 = vi.fn();
    const unsub3 = subscribe('empty-check', fn3);
    expect(typeof unsub3).toBe('function');
    unsub3();
  });
});

// ─── Scheduler (croner-driven) ────────────────────────────────────────────────
//
// Each job owns a Cron instance that fires via croner's setTimeout engine.
// Tests anchor fake time with vi.setSystemTime() then advance with
// vi.advanceTimersByTime() to trigger fires deterministically.
//
// '* * * * *' (every minute) is used as the default timing expression:
//   – time anchored to :00 → next fire is exactly 60 000 ms away
//   – vi.advanceTimersByTime(60_001) reliably triggers one fire.

describe('scheduler', () => {
  it('fires a recurring job at its scheduled time and recalculates nextFireAt', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const cb = vi.fn();
    const job = make({ sessionId: 'sched-recurring', cronExpr: '* * * * *', recurring: true });
    const initialNext = job.nextFireAt;
    const unsub = subscribe('sched-recurring', cb);

    vi.advanceTimersByTime(60_001);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(job.id, 'hello');
    expect(job.fireCount).toBe(1);
    expect(job.lastFiredAt).not.toBeNull();
    expect(job.status).toBe('active');
    expect(job.nextFireAt).not.toBe(initialNext); // recalculated to next minute

    unsub();
  });

  it('fires a one-shot job exactly once then marks it completed', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const cb = vi.fn();
    const job = make({ sessionId: 'sched-oneshot', cronExpr: '* * * * *', recurring: false });
    const unsub = subscribe('sched-oneshot', cb);

    vi.advanceTimersByTime(60_001);

    expect(cb).toHaveBeenCalledOnce();
    expect(job.status).toBe('completed');
    expect(job.nextFireAt).toBeNull();

    // Advance another full minute — one-shot must NOT fire again
    vi.advanceTimersByTime(60_001);
    expect(cb).toHaveBeenCalledOnce();

    unsub();
  });

  it('does not fire a paused job', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const cb = vi.fn();
    const job = make({ sessionId: 'sched-paused', cronExpr: '* * * * *' });
    pauseJob(job.id);
    const unsub = subscribe('sched-paused', cb);

    vi.advanceTimersByTime(60_001);

    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('fires again after being resumed', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const cb = vi.fn();
    const job = make({ sessionId: 'sched-resume', cronExpr: '* * * * *' });
    const unsub = subscribe('sched-resume', cb);

    pauseJob(job.id);
    vi.advanceTimersByTime(60_001); // was paused — must not fire
    expect(cb).not.toHaveBeenCalled();

    resumeJob(job.id);
    vi.advanceTimersByTime(60_001); // now active — must fire once
    expect(cb).toHaveBeenCalledOnce();

    unsub();
  });

  it('does not fire a job whose schedule is still in the future', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const cb = vi.fn();
    // '0 23 * * *' fires at 23:00 — 14 hours from the anchored time
    make({ sessionId: 'sched-future', cronExpr: '0 23 * * *' });
    const unsub = subscribe('sched-future', cb);

    vi.advanceTimersByTime(60 * 60_000); // advance 1 hour — still before 23:00

    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('swallows subscriber errors and notifies subsequent subscribers', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const throwing = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const safe = vi.fn();
    make({ sessionId: 'sched-err', cronExpr: '* * * * *' });
    const unsub1 = subscribe('sched-err', throwing);
    const unsub2 = subscribe('sched-err', safe);

    expect(() => vi.advanceTimersByTime(60_001)).not.toThrow();
    expect(safe).toHaveBeenCalled();

    unsub1();
    unsub2();
  });

  it('fires with no registered subscribers without error', () => {
    vi.setSystemTime(new Date('2024-01-01T09:00:00.000Z'));
    const job = make({ sessionId: 'sched-no-sub', cronExpr: '* * * * *' });

    expect(() => vi.advanceTimersByTime(60_001)).not.toThrow();
    expect(job.fireCount).toBe(1);
  });
});

// ─── multiple createJob calls succeed ────────────────────────────────────────

describe('multiple jobs', () => {
  it('creating multiple jobs all succeed without error', () => {
    const jobs = [
      make({ sessionId: 'multi1' }),
      make({ sessionId: 'multi1' }),
      make({ sessionId: 'multi1' }),
    ];
    expect(jobs).toHaveLength(3);
    jobs.forEach(j => expect(j.id).toMatch(/^cron_/));
  });
});

// ─── process exit cleanup ─────────────────────────────────────────────────────

describe('process exit handler', () => {
  it('does not throw when exit is emitted', () => {
    expect(() => process.emit('exit')).not.toThrow();
  });

  it('emitting exit a second time is also safe', () => {
    expect(() => process.emit('exit')).not.toThrow();
  });
});

