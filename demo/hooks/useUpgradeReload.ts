import { useEffect } from 'react';
import { checkHealth } from '../api/backend';

const POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 5_000;
/** Number of consecutive failures required before we consider the server down. */
const FAIL_THRESHOLD = 3;

/**
 * Polls health endpoint in the background.
 *
 * When the server goes down (request fails or returns a non-2xx status) and
 * subsequently comes back up, triggers a full page reload so the frontend
 * picks up the newly deployed version.
 *
 * Requires FAIL_THRESHOLD consecutive failures before marking the server as
 * down — this prevents a transient timeout (e.g. during heavy Vite startup)
 * from spuriously reloading the page mid-session.
 */
export function useUpgradeReload(): void {
  useEffect(() => {
    // 'unknown' → 'up' → 'down' → 'up' (reload on this last transition)
    // Initial failures (backend not yet started) stay in 'unknown' and never
    // trigger a reload; only a down→up transition after a confirmed 'up' does.
    let status: 'unknown' | 'up' | 'down' = 'unknown';
    let failCount = 0;

    const id = setInterval(async () => {
      try {
        await checkHealth(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
        failCount = 0;
        if (status === 'down') window.location.reload();
        status = 'up';
      } catch {
        // Network error or timeout — server is potentially down.
        failCount++;
        if (failCount >= FAIL_THRESHOLD && status === 'up') status = 'down';
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);
}
