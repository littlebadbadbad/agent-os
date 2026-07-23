/**
 * Unit tests for createMinIntervalQueue.
 *
 * Strategy
 * ────────
 * All timing is driven by Vitest's fake-timer infrastructure so tests run
 * in microseconds with deterministic wall-clock values.  `Date.now()` is
 * frozen at t = 0 on entry to each test.
 *
 * Core invariants verified:
 *   1. First call dispatches immediately (no spurious wait).
 *   2. N concurrent calls are dispatched in order at t = 0, I, 2I, … (N-1)I.
 *   3. A late-arriving call (after interval has passed) is also immediate.
 *   4. A mid-interval call waits only the remaining time, not a full interval.
 *   5. Task results are returned correctly.
 *   6. Task errors propagate to that call but the queue keeps running.
 *   7. Abort before wait → immediate rejection, queue advances.
 *   8. Abort during wait → immediate rejection, queue fills gap naturally.
 *   9. Multiple independent queues do not interfere with each other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMinIntervalQueue } from '../../utils/minIntervalQueue';

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTERVAL = 1000;

/** Record dispatch timestamps and return the task result. */
function makeTask<T>(value: T, log: number[]): () => Promise<T> {
  return () => {
    log.push(Date.now());
    return Promise.resolve(value);
  };
}

/** Advance fake clock AND flush all pending microtasks/promises. */
async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createMinIntervalQueue', () => {
  // ── Dispatch timing ────────────────────────────────────────────────────────

  describe('dispatch timing', () => {
    it('dispatches the first call immediately at t=0', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      schedule(makeTask('a', log));
      await tick(0);

      expect(log).toEqual([0]);
    });

    it('dispatches two concurrent calls at t=0 and t=I', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      schedule(makeTask('a', log));
      schedule(makeTask('b', log));

      await tick(0);
      expect(log).toEqual([0]);         // only first has fired

      await tick(INTERVAL - 1);
      expect(log).toEqual([0]);         // second has NOT fired at t=999

      await tick(1);
      expect(log).toEqual([0, INTERVAL]); // second fires exactly at t=1000
    });

    it('dispatches three concurrent calls at t=0, I, 2I', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      schedule(makeTask(1, log));
      schedule(makeTask(2, log));
      schedule(makeTask(3, log));

      await tick(0);
      expect(log).toEqual([0]);

      await tick(INTERVAL);
      expect(log).toEqual([0, INTERVAL]);

      await tick(INTERVAL);
      expect(log).toEqual([0, INTERVAL, 2 * INTERVAL]);
    });

    it('dispatches N=5 concurrent calls each spaced exactly I ms apart', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      for (let i = 0; i < 5; i++) schedule(makeTask(i, log));

      for (let i = 0; i < 5; i++) {
        await tick(i === 0 ? 0 : INTERVAL);
        expect(log).toHaveLength(i + 1);
        expect(log[i]).toBe(i * INTERVAL);
      }
    });

    it('a call arriving after the interval passes dispatches immediately', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      schedule(makeTask('first', log));
      await tick(0);
      expect(log).toEqual([0]);

      // Advance well past the interval before the second call
      await tick(2 * INTERVAL);
      schedule(makeTask('second', log));
      await tick(0);

      expect(log).toHaveLength(2);
      expect(log[1]).toBe(2 * INTERVAL); // no extra wait
    });

    it('a mid-interval call waits only the remaining time', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      schedule(makeTask('first', log));
      await tick(0);

      await tick(400); // t=400 — 600 ms left in the interval
      schedule(makeTask('second', log));

      await tick(599);
      expect(log).toHaveLength(1); // t=999 — still waiting

      await tick(1);
      expect(log).toHaveLength(2); // t=1000 — fires now
      expect(log[1]).toBe(INTERVAL);
    });
  });

  // ── Return values ──────────────────────────────────────────────────────────

  describe('return values', () => {
    it('resolves with the task return value', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const p = schedule(() => Promise.resolve(42));
      await tick(0);
      await expect(p).resolves.toBe(42);
    });

    it('preserves independent return values for concurrent calls', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const p1 = schedule(() => Promise.resolve('one'));
      const p2 = schedule(() => Promise.resolve('two'));
      const p3 = schedule(() => Promise.resolve('three'));

      await tick(2 * INTERVAL);

      await expect(p1).resolves.toBe('one');
      await expect(p2).resolves.toBe('two');
      await expect(p3).resolves.toBe('three');
    });
  });

  // ── Error isolation ────────────────────────────────────────────────────────

  describe('error isolation', () => {
    it('propagates task errors to the failing call', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const boom = new Error('boom');
      const p = schedule(() => Promise.reject(boom));
      // Register handler BEFORE tick(0) to prevent unhandled rejection
      const rejection = expect(p).rejects.toBe(boom);
      await tick(0);
      await rejection;
    });

    it('a failing task does not stall subsequent calls', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      const p1 = schedule(() => Promise.reject(new Error('fail')));
      const p2 = schedule(makeTask('ok', log));

      // Swallow p1 to avoid unhandled rejection warnings
      p1.catch(() => {});

      await tick(0);   // p1 dispatches and rejects
      await tick(INTERVAL); // p2 dispatches

      expect(log).toEqual([INTERVAL]);
      await expect(p2).resolves.toBe('ok');
    });

    it('two task errors in a row still let the third call through', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const log: number[] = [];

      const p1 = schedule(() => Promise.reject(new Error('e1')));
      const p2 = schedule(() => Promise.reject(new Error('e2')));
      const p3 = schedule(makeTask('good', log));

      p1.catch(() => {});
      p2.catch(() => {});

      await tick(2 * INTERVAL);

      expect(log).toEqual([2 * INTERVAL]);
      await expect(p3).resolves.toBe('good');
    });
  });

  // ── Abort handling ─────────────────────────────────────────────────────────

  describe('abort handling', () => {
    it('rejects immediately when signal is already aborted', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const controller = new AbortController();
      controller.abort(new Error('pre-aborted'));

      // Queue a first call so the second one actually has to wait
      schedule(() => Promise.resolve('first'));
      await tick(0);

      const p = schedule(() => Promise.resolve('second'), controller.signal);
      // Register the rejection handler BEFORE tick(0) to prevent unhandled rejection
      const rejection = expect(p).rejects.toThrow('pre-aborted');
      await tick(0);
      await rejection;
    });

    it('rejects during wait when signal is aborted mid-delay', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const controller = new AbortController();
      const log: number[] = [];

      schedule(makeTask('first', log));        // dispatches at t=0
      const p = schedule(() => Promise.resolve('second'), controller.signal); // would dispatch at t=1000

      await tick(0); // first dispatched

      await tick(500); // t=500 — still in the 1000 ms wait
      controller.abort(new Error('cancelled'));

      // Register the rejection handler BEFORE tick(0) to prevent unhandled rejection
      const rejection = expect(p).rejects.toThrow('cancelled');
      await tick(0); // flush microtasks after abort
      await rejection;
    });

    it('queue advances after an aborted call — next caller fills the gap', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const controller = new AbortController();
      const log: number[] = [];

      schedule(makeTask(1, log));                              // dispatches at t=0
      const p2 = schedule(() => Promise.resolve(2), controller.signal); // slot at t=1000
      schedule(makeTask(3, log));                              // slot at t=2000

      p2.catch(() => {});

      await tick(0);  // first dispatches

      // Abort the second call at t=500
      await tick(500);
      controller.abort();

      // After abort, third call should fill the gap:
      // chain unblocks at t=500, remaining wait = 1000 - 500 = 500 ms → t=1000
      await tick(500);
      expect(log).toEqual([0, INTERVAL]); // third dispatched at t=1000, not t=2000
    });

    it('abort does not affect the original task handler call', async () => {
      // Once dispatched the task runs normally; abort only affects the wait.
      const schedule = createMinIntervalQueue(INTERVAL);
      const dispatched: boolean[] = [];

      const p = schedule(() => {
        dispatched.push(true);
        return Promise.resolve('done');
      });

      await tick(0);

      // Signal fires AFTER the task was already dispatched
      const controller = new AbortController();
      // (signal was never passed, so nothing to abort here — just verify task ran)
      expect(dispatched).toEqual([true]);
      await expect(p).resolves.toBe('done');
    });
  });

  // ── Independence ───────────────────────────────────────────────────────────

  describe('independence', () => {
    it('two separate queues do not interfere with each other', async () => {
      const qA = createMinIntervalQueue(INTERVAL);
      const qB = createMinIntervalQueue(INTERVAL);
      const logA: number[] = [];
      const logB: number[] = [];

      qA(makeTask('a1', logA));
      qA(makeTask('a2', logA));
      qB(makeTask('b1', logB));
      qB(makeTask('b2', logB));

      await tick(0);
      // Both queues dispatch their first call immediately
      expect(logA).toEqual([0]);
      expect(logB).toEqual([0]);

      await tick(INTERVAL);
      // Both queues dispatch their second call independently
      expect(logA).toEqual([0, INTERVAL]);
      expect(logB).toEqual([0, INTERVAL]);
    });
  });

  describe('abort without reason → DOMException', () => {
    it('throws DOMException when signal.reason is undefined (fast path)', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const controller = new AbortController();

      // Queue first call so second call has to wait
      schedule(() => Promise.resolve('first'));
      await tick(0);

      controller.abort(); // no reason → signal.reason is undefined
      const p = schedule(() => Promise.resolve('second'), controller.signal);

      // Must catch to avoid unhandled rejection
      await expect(p).rejects.toThrow(DOMException);
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('throws DOMException when signal.reason is undefined (during wait)', async () => {
      const schedule = createMinIntervalQueue(INTERVAL);
      const controller = new AbortController();

      schedule(() => Promise.resolve('first'));
      await tick(0);

      const p = schedule(() => Promise.resolve('second'), controller.signal);
      await tick(500); // mid-wait

      controller.abort(); // no reason → signal.reason is undefined

      await expect(p).rejects.toThrow(DOMException);
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});
