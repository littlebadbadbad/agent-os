const noop = (): void => {};

/**
 * Creates a sequential scheduler that ensures each task is dispatched at least
 * `intervalMs` after the previous dispatch.
 *
 * Every call is queued and guaranteed to execute once — none are dropped.
 * When a task's abort signal fires while it is waiting in the queue the wait
 * is cancelled and the queue advances immediately, so aborted slots are not
 * "wasted": the next waiter fills the gap at the natural interval from the
 * last *successful* dispatch.
 *
 * @example
 * ```ts
 * const schedule = createMinIntervalQueue(1000);
 *
 * // Three concurrent calls → dispatched at t=0, t=1000, t=2000
 * const [a, b, c] = await Promise.all([
 *   schedule(() => fetch('/api/a')),
 *   schedule(() => fetch('/api/b')),
 *   schedule(() => fetch('/api/c')),
 * ]);
 * ```
 */
export function createMinIntervalQueue(intervalMs: number) {
  // Initialise to -Infinity so the first call always dispatches immediately
  // regardless of the system clock value (including fake timers at t=0).
  let lastDispatchTime = Number.NEGATIVE_INFINITY;

  // `chain` tracks the tail of the timing-slot queue.  Only the *timing phase*
  // of each slot is chained — task execution is fire-and-forget from the slot
  // — so task duration does not affect when the next slot is allowed to start.
  let chain = Promise.resolve<void>(undefined);

  return function schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const slot = chain.then(async () => {
      // Fast path: signal already aborted before we even start waiting.
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      const wait = intervalMs - (Date.now() - lastDispatchTime);
      if (wait > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, wait);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }

      // Record dispatch time *before* resolving the slot so the next slot
      // can calculate its wait the moment it starts.
      lastDispatchTime = Date.now();
    });

    // Advance the queue tail.  Swallow errors so an aborted / failed slot
    // never freezes subsequent waiters.
    chain = slot.then(noop, noop);

    // Run the actual task only after this slot's timing phase completes.
    return slot.then(() => task());
  };
}
