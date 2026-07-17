/**
 * extensions/cron/ui/main.tsx — Cron plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads slotContext from window.__UAP_PLUGIN_HOST__ to know
 *     which slot instance it's rendering.
 *   - For panel slot: renders CronPanel with job list and actions.
 *   - Reads the adapter from ToolSet's symbol state (exposed via
 *     `onGetSymbolState`) and uses it for all backend calls.
 *     NO `host.apiClient.call()` — follows the same adapter pattern
 *     as browser/terminal extensions.
 */

import { StrictMode, useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { UiPluginHost, SlotHostMessage } from "@agent-type";
import type { CronSymbolState } from "../agent/types";
import type { CronJob } from "../agent/types";
import { CronPanel } from "./CronPanel";

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost;
  }
}

function waitForHost(timeout = 10000): Promise<UiPluginHost> {
  return new Promise((resolve, reject) => {
    if (window.__UAP_PLUGIN_HOST__) {
      resolve(window.__UAP_PLUGIN_HOST__);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.__UAP_PLUGIN_HOST__) {
        clearInterval(interval);
        resolve(window.__UAP_PLUGIN_HOST__);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for __UAP_PLUGIN_HOST__"));
      }
    }, 50);
  });
}

waitForHost()
  .then((host) => { bootApp(host); })
  .catch((err) => {
    console.error("[cron-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Cron plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  // ── Read the cron adapter from ToolSet symbol state ──────────────────
  // This is the SAME adapter that the ToolSet uses internally.
  // Every extension (browser, terminal, etc.) exposes its adapter this way.
  const pluginState = host.getPluginState();
  const cronSymbolState = pluginState?.[1] as CronSymbolState | undefined;
  const cronAdapter = cronSymbolState?.cronAdapter;
  if (!cronAdapter) {
    console.warn("[cron-ui] cronAdapter not available from plugin state");
  }

  async function fetchJobs(): Promise<readonly CronJob[]> {
    if (!cronAdapter) return [];
    try {
      return await cronAdapter.listJobs({ sessionId: slotCtx.sessionId });
    } catch {
      return [];
    }
  }

  // ── Actions — all go through the adapter, never apiClient ────────────

  const actions = {
    pauseJob: async (_setJobs: (j: readonly CronJob[]) => void, id: string) => {
      if (!cronAdapter) return;
      await cronAdapter.pauseJob(id, slotCtx.sessionId);
      _setJobs(await fetchJobs());
    },
    resumeJob: async (_setJobs: (j: readonly CronJob[]) => void, id: string) => {
      if (!cronAdapter) return;
      await cronAdapter.resumeJob(id, slotCtx.sessionId);
      _setJobs(await fetchJobs());
    },
    deleteJob: async (_setJobs: (j: readonly CronJob[]) => void, id: string) => {
      if (!cronAdapter) return;
      await cronAdapter.deleteJob(id, slotCtx.sessionId);
      _setJobs(await fetchJobs());
    },
  };

  // ── App component ────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");

  function App() {
    const [jobs, setJobs] = useState<readonly CronJob[]>([]);

    // Load initial jobs from backend.
    useEffect(() => {
      fetchJobs().then(setJobs);
    }, []);

    // Listen for host→iframe panel messages — refresh from adapter.
    useEffect(() => {
      const unsub = host.onSlotMessage((msg: SlotHostMessage) => {
        if (msg.type === "panel") {
          fetchJobs().then(setJobs);
        }
      });
      return unsub;
    }, []);

    const handlePause = useCallback(
      (id: string) => actions.pauseJob(setJobs, id),
      [],
    );
    const handleResume = useCallback(
      (id: string) => actions.resumeJob(setJobs, id),
      [],
    );
    const handleDelete = useCallback(
      (id: string) => actions.deleteJob(setJobs, id),
      [],
    );

    return (
      <CronPanel
        jobs={jobs}
        onPause={handlePause}
        onResume={handleResume}
        onDelete={handleDelete}
      />
    );
  }

  if (rootEl) {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}
