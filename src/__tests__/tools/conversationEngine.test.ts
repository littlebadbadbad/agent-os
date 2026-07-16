/**
 * Tests for the unified conversation execution engine.
 *
 * Verifies that `runEngine` correctly manages the loading-state lifecycle:
 *   onBeforeRun → isLoading=true → notify → run → outcome → isLoading=false → notify → onAfterRun
 */

import { describe, it, expect, vi } from 'vitest';
import { runEngine, type EngineRefs, type EngineHooks, type EngineRunResult } from '../../tools/conversationEngine';

describe('runEngine', () => {
  // ── Helpers ───────────────────────────────────────────────────────────────

  function makeRefs(): EngineRefs {
    return { isLoading: false, abortController: null };
  }

  async function runSuccessful(
    refs: EngineRefs = makeRefs(),
    hooks: EngineHooks = {},
    run: (signal: AbortSignal) => Promise<EngineRunResult> = async () => ({ outcome: 'completed' as const }),
  ): Promise<void> {
    const notify = vi.fn();
    await runEngine(refs, hooks, run, notify);
    return undefined;
  }

  // ── Loading lifecycle ─────────────────────────────────────────────────────

  it('sets isLoading to true before running and false after', async () => {
    const refs = makeRefs();
    const notify = vi.fn();

    const run = vi.fn(async (_signal: AbortSignal): Promise<EngineRunResult> => {
      expect(refs.isLoading).toBe(true);
      return { outcome: 'completed' };
    });

    await runEngine(refs, {}, run, notify);

    expect(refs.isLoading).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });

  it('manages AbortController lifecycle correctly', async () => {
    const refs = makeRefs();

    expect(refs.abortController).toBeNull();

    await runEngine(
      refs,
      {},
      async (signal) => {
        expect(refs.abortController).not.toBeNull();
        expect(signal).toBe(refs.abortController!.signal);
        return { outcome: 'completed' };
      },
      vi.fn(),
    );

    expect(refs.abortController).toBeNull();
  });

  // ── Notify ────────────────────────────────────────────────────────────────

  it('calls notify twice: once after isLoading=true, once after isLoading=false', async () => {
    const refs = makeRefs();
    const notify = vi.fn();

    await runEngine(
      refs,
      {},
      async () => {
        expect(notify).toHaveBeenCalledTimes(1); // called after isLoading=true
        return { outcome: 'completed' };
      },
      notify,
    );

    expect(notify).toHaveBeenCalledTimes(2);
    expect(refs.isLoading).toBe(false);
  });

  // ── Hooks ─────────────────────────────────────────────────────────────────

  it('calls onBeforeRun before isLoading becomes true', async () => {
    const refs = makeRefs();
    const onBeforeRun = vi.fn(() => {
      expect(refs.isLoading).toBe(false);
    });

    await runEngine(
      refs,
      { onBeforeRun },
      async () => {
        expect(onBeforeRun).toHaveBeenCalledOnce();
        return { outcome: 'completed' };
      },
      vi.fn(),
    );

    expect(onBeforeRun).toHaveBeenCalledOnce();
  });

  it('calls onAfterRun with the outcome after isLoading is false', async () => {
    const refs = makeRefs();
    const onAfterRun = vi.fn();

    await runEngine(
      refs,
      { onAfterRun },
      async () => ({ outcome: 'completed' }),
      vi.fn(),
    );

    expect(onAfterRun).toHaveBeenCalledOnce();
    expect(onAfterRun).toHaveBeenCalledWith('completed');
    expect(refs.isLoading).toBe(false);
  });

  it('passes aborted outcome when run throws an AbortError', async () => {
    const refs = makeRefs();
    const onAfterRun = vi.fn();

    await expect(
      runEngine(
        refs,
        { onAfterRun },
        async (_signal) => {
          refs.abortController?.abort();
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        },
        vi.fn(),
      ),
    ).rejects.toThrow();

    expect(onAfterRun).toHaveBeenCalledOnce();
    expect(onAfterRun).toHaveBeenCalledWith('aborted');
    expect(refs.isLoading).toBe(false);
  });

  it('passes error outcome when run throws a non-abort error', async () => {
    const refs = makeRefs();
    const onAfterRun = vi.fn();

    await expect(
      runEngine(
        refs,
        { onAfterRun },
        async () => { throw new Error('Something broke'); },
        vi.fn(),
      ),
    ).rejects.toThrow('Something broke');

    expect(onAfterRun).toHaveBeenCalledOnce();
    expect(onAfterRun).toHaveBeenCalledWith('error');
    expect(refs.isLoading).toBe(false);
  });

  it('onAfterRun is NOT called when onBeforeRun throws', async () => {
    const refs = makeRefs();
    const beforeErr = new Error('before run failed');
    const onAfterRun = vi.fn();

    await expect(
      runEngine(
        refs,
        { onBeforeRun: () => { throw beforeErr; }, onAfterRun },
        async () => ({ outcome: 'completed' }),
        vi.fn(),
      ),
    ).rejects.toThrow('before run failed');

    expect(onAfterRun).not.toHaveBeenCalled();
    // isLoading should still be false because the error happened before setting it
    expect(refs.isLoading).toBe(false);
  });

  // ── Outcome fidelity ──────────────────────────────────────────────────────

  it.each([
    ['completed', 'completed' as const],
    ['max-turns', 'max-turns' as const],
    ['aborted', 'aborted' as const],
    ['error', 'error' as const],
  ])('returns %s outcome from the run function', async (label, expectedOutcome) => {
    const refs = makeRefs();
    const onAfterRun = vi.fn();

    await runEngine(
      refs,
      { onAfterRun },
      async () => ({ outcome: expectedOutcome }),
      vi.fn(),
    );

    expect(onAfterRun).toHaveBeenCalledOnce();
    expect(onAfterRun).toHaveBeenCalledWith(expectedOutcome);
  });

  // ── Abort signal forwarding ───────────────────────────────────────────────

  it('aborts the in-flight AbortController when abort() is called on the refs', async () => {
    const refs = makeRefs();

    const runPromise = runEngine(
      refs,
      {},
      async (signal) => {
        // Simulate a long-running task
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          signal.addEventListener('abort', onAbort);
        });
        return { outcome: 'aborted' };
      },
      vi.fn(),
    );

    // Abort from outside
    refs.abortController!.abort();

    await runPromise;

    expect(refs.isLoading).toBe(false);
    expect(refs.abortController).toBeNull();
  });

  // ── Notify timing ─────────────────────────────────────────────────────────

  it('notifies synchronously after isLoading changes (before run starts)', async () => {
    const refs = makeRefs();
    const notify = vi.fn();

    await runEngine(
      refs,
      {},
      async () => {
        // isLoading should already be true AND subscribers should have been notified
        expect(refs.isLoading).toBe(true);
        return { outcome: 'completed' };
      },
      notify,
    );

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('notify is called even when run throws', async () => {
    const refs = makeRefs();
    const notify = vi.fn();

    await expect(
      runEngine(
        refs,
        {},
        async () => { throw new Error('fail'); },
        notify,
      ),
    ).rejects.toThrow('fail');

    // Called twice: once for isLoading=true, once for isLoading=false
    expect(notify).toHaveBeenCalledTimes(2);
    expect(refs.isLoading).toBe(false);
  });
});
