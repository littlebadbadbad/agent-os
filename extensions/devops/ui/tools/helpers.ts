/**
 * Shared helpers for DevOps agent tools.
 * All tools use uiBridge to communicate with React components.
 */

import { uiBridge } from './uiBridge';

/** Route an async action through uiBridge. */
export async function bridgeCall<T>(key: string, ...args: unknown[]): Promise<T> {
  return uiBridge.call<T>(key, ...args);
}

/** Read a state snapshot synchronously from uiBridge. */
export function bridgeSnap<T>(key: string): T {
  return uiBridge.snapshot<T>(key);
}

/** Pass-through for JSON-serializable return values. */
export function stateResult(data: unknown) {
  return data;
}

/**
 * Wait for one or more uiBridge handlers to become registered.
 * Uses polling (200ms interval). Throws on timeout.
 *
 * CRITICAL: After dispatching a React action (SELECT_PROJECT, SET_VIEW, etc.),
 * the component re-render + useEffect handler registration is ASYNC.
 * Always call this before using handlers that may not be mounted yet.
 */
export async function waitForRegistered(keys: string[], timeoutMs = 10_000): Promise<void> {
  await uiBridge.waitUntil(
    () => keys.every((k) => uiBridge.isRegistered(k)),
    timeoutMs,
    200,
  );
}

/** Wait specifically for WorkItemsPage bridge handlers to be available. */
export async function waitForWorkItemHandlers(): Promise<void> {
  await waitForRegistered(['wi.getState', 'wi.setType', 'wi.setFilter', 'wi.setPage'], 10_000);
}
