/**
 * extensions/cron/ui/main.tsx — Cron plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads slotContext from window.__UAP_PLUGIN_HOST__ to know
 *     which slot instance it's rendering.
 *   - For panel slot: renders CronPanel with job list and actions.
 *   - Receives host->iframe messages via host.onSlotMessage().
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { UiPluginHost, SlotHostMessage } from "@agent-type";
import type { CronSymbolState } from "../agent/types";
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

  // Reactive store mirroring the ToolSet's symbol state.
  let cronState = host.getPluginState()?.[1] as CronSymbolState | undefined ?? null;
  const listeners = new Set<() => void>();

  const emitChange = () => {
    const state = host.getPluginState();
    cronState = state?.[1] as CronSymbolState | undefined ?? null;
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  const getSnapshot = () => cronState;

  // Subscribe to host->iframe state updates.
  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === "panel") {
      emitChange();
    }
  });

  // Also poll for state changes via subscribe pattern.
  // (fallback when host doesn't push panel messages)

  // Actions - call backend directly via apiClient.
  const actions = {
    pauseJob: async (id: string) => {
      await host.apiClient.call("pauseJob", { id, sessionId: slotCtx.id });
      emitChange();
    },
    resumeJob: async (id: string) => {
      await host.apiClient.call("resumeJob", { id, sessionId: slotCtx.id });
      emitChange();
    },
    deleteJob: async (id: string) => {
      await host.apiClient.call("deleteJob", { id, sessionId: slotCtx.id });
      emitChange();
    },
  };

  const rootEl = document.getElementById("root");

  function App() {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const jobs = state?.jobs ?? [];

    return (
      <CronPanel
        jobs={jobs}
        onPause={actions.pauseJob}
        onResume={actions.resumeJob}
        onDelete={actions.deleteJob}
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
