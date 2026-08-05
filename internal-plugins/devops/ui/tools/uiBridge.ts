/**
 * uiBridge — Global singleton that bridges agent tools ↔ React component state.
 *
 * React components register "handlers" (state setters / action callbacks / state
 * snapshot getters) on mount and unregister on unmount.  Agent tools call these
 * handlers through the bridge, allowing the agent to fully control the UI.
 *
 * Key patterns:
 *   • Action handlers  — stable React setState / useCallback refs, registered once.
 *   • State snapshots  — registered via a zero-arg getter that reads a useRef.current
 *                        so the snapshot is always fresh without re-registering.
 *   • Async wait       — waitUntil() polls a predicate, letting tools wait for
 *                        loading spinners to finish before reading results.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => any;

export class UiBridge {
  private handlers = new Map<string, AnyHandler>();

  /** Register a handler for the given key.  Overwrites any previous registration. */
  register(key: string, handler: AnyHandler): void {
    this.handlers.set(key, handler);
  }

  /** Unregister a handler (call from useEffect cleanup). */
  unregister(key: string): void {
    this.handlers.delete(key);
  }

  /**
   * Call a registered handler asynchronously.
   * Throws a descriptive error if the handler is not mounted yet.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call<T = unknown>(key: string, ...args: any[]): Promise<T> {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new Error(
        `[uiBridge] No handler for "${key}". ` +
          `Make sure the relevant component is mounted and the correct view is active.`,
      );
    }
    return (await handler(...args)) as T;
  }

  /**
   * Read a state snapshot synchronously via a registered zero-arg getter.
   * Throws if the getter has not been registered.
   */
  snapshot<T = unknown>(key: string): T {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new Error(
        `[uiBridge] No snapshot getter for "${key}". ` +
          `Make sure the relevant component is mounted.`,
      );
    }
    return handler() as T;
  }

  /** Whether a handler is currently registered. */
  isRegistered(key: string): boolean {
    return this.handlers.has(key);
  }

  /**
   * Poll until `predicate()` returns true, up to `timeoutMs`.
   * Use this when a tool triggers an async operation and needs to wait for it.
   *
   * @example
   *   bridge.call('sprints.selectTeam', id);
   *   await bridge.waitUntil(() => !bridge.snapshot<SprintsState>('sprints.state').sprintsLoading);
   */
  async waitUntil(
    predicate: () => boolean,
    timeoutMs = 20_000,
    intervalMs = 200,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise<void>((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`[uiBridge] waitUntil timed out after ${timeoutMs}ms`);
  }
}

export const uiBridge = new UiBridge();
