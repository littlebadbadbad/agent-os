/**
 * extensions/token-budget/ui/main.tsx — Token Budget plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads `slotContext` from `window.__UAP_PLUGIN_HOST__` to know
 *     which slot instance it's rendering.
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *   - Sends iframe→host messages via `host.sendSlotMessage()`.
 *
 * For the `headerBar` slot type, the host pushes `HeaderBarHostMessage`
 * on every state change. The iframe re-reads `host.getPluginState()`
 * to get the latest `TokenBudgetSymbolState`.
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly. All communication
 *   with the host flows through the injected {@link UiPluginHost}.
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  SlotHostMessage,
} from "@agent-type";
import { TokenProgressBar } from "./TokenProgressBar";
import { getTokenBudgetSymbolState } from "./types";

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
    console.error("[token-budget-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Token Budget plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  // ── Reactive store ────────────────────────────────────────────────────────

  let tbState = getTokenBudgetSymbolState(host.getPluginState());
  const listeners = new Set<() => void>();

  const emitChange = () => {
    tbState = getTokenBudgetSymbolState(host.getPluginState());
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  const getSnapshot = () => tbState;

  // ── Host→iframe messages ──────────────────────────────────────────────────

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case "headerBar":
        emitChange();
        break;
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function TokenBudgetApp() {
    const state = useSyncExternalStore(subscribe, getSnapshot);
    const tokenBudget = state?.tokenBudget;

    if (slotCtx.slotType === "headerBar") {
      if (!tokenBudget) return null;
      return <TokenProgressBar state={tokenBudget} />;
    }

    // Unknown slot type — render nothing.
    return null;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <TokenBudgetApp />
      </StrictMode>,
    );
  }
}
