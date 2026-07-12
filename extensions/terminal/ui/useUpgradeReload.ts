/**
 * extensions/terminal/ui/useUpgradeReload.ts — Upgrade reload hook
 *
 * Polls the backend health endpoint in the background.
 * When the server goes down (after upgrade_restart) and subsequently comes
 * back up, triggers a full page reload so the frontend picks up the newly
 * deployed version.
 *
 * Requires FAIL_THRESHOLD consecutive failures before marking the server as
 * down — prevents transient timeouts from spuriously reloading the page.
 */

import { useEffect } from "react";

const POLL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 5_000;
const FAIL_THRESHOLD = 3;

async function checkHealth(signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/health", { signal });
  if (!res.ok) throw new Error(`Health check returned ${res.status}`);
}

export function useUpgradeReload(): void {
  useEffect(() => {
    let status: "unknown" | "up" | "down" = "unknown";
    let failCount = 0;

    const id = setInterval(async () => {
      try {
        await checkHealth(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
        failCount = 0;
        if (status === "down") window.location.reload();
        status = "up";
      } catch {
        failCount++;
        if (failCount >= FAIL_THRESHOLD && status === "up") status = "down";
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);
}
