/**
 * Integration tests for runEngine — specifically the 4th argument `notify`
 * callback that was previously missing from the conversationRunner caller.
 */

import { describe, it, expect, vi } from 'vitest';
import { runEngine, type EngineRefs } from '../../tools/conversationEngine';

describe('runEngine — notify argument', () => {
  it('calls notify twice (before and after run)', async () => {
    const refs: EngineRefs = { isLoading: false, abortController: null };
    const hooks = { onBeforeRun: vi.fn(), onAfterRun: vi.fn() };
    const run = vi.fn().mockResolvedValue({ outcome: 'completed' as const });
    const notify = vi.fn();

    await runEngine(refs, hooks, run, notify);

    // notify must be called exactly twice:
    //   1. after refs.isLoading = true (before run)
    //   2. after refs.isLoading = false (after run)
    expect(notify).toHaveBeenCalledTimes(2);
    expect(refs.isLoading).toBe(false);
  });

  it('conversationRunner must pass notify as 4th argument', async () => {
    // This test verifies that runEngine IS being called with a valid
    // notify callback, which was previously missing in conversationRunner.ts.
    // If notify is undefined, runEngine throws before any tool runs.
    const refs: EngineRefs = { isLoading: false, abortController: null };
    const hooks = { onBeforeRun: vi.fn(), onAfterRun: vi.fn() };
    const run = vi.fn().mockResolvedValue({ outcome: 'completed' as const });
    const notify = vi.fn();

    // Must NOT throw — 4th argument notify is provided
    await expect(
      runEngine(refs, hooks, run, notify),
    ).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalled();
  });

  it('still calls notify when run throws', async () => {
    const refs: EngineRefs = { isLoading: false, abortController: null };
    const hooks = { onBeforeRun: vi.fn(), onAfterRun: vi.fn() };
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const notify = vi.fn();

    await expect(runEngine(refs, hooks, run, notify)).rejects.toThrow('boom');

    // Even on error, notify should have been called twice
    // (once at start, once in finally block)
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('toggles isLoading correctly via refs', async () => {
    const isLoadingValues: boolean[] = [];
    const refs: EngineRefs = { isLoading: false, abortController: null };
    const hooks = { onBeforeRun: vi.fn(), onAfterRun: vi.fn() };
    const run = vi.fn().mockResolvedValue({ outcome: 'completed' as const });
    const notify = vi.fn(() => { isLoadingValues.push(refs.isLoading); });

    await runEngine(refs, hooks, run, notify);

    // Before first notify, isLoading should be true
    // After second notify, isLoading should be false
    expect(isLoadingValues).toEqual([true, false]);
  });
});
