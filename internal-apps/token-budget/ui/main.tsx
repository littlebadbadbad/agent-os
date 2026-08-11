/**
 * internal-apps/token-budget/ui/main.tsx — Token Budget app UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads `slotContext` from `window.__UAP_APP_HOST__` to know
 *     which slot instance it's rendering.
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *
 * For the `headerBar` slot type, the host pushes `HeaderBarHostMessage`
 * on every state change. The iframe re-reads `host.getAppState()`
 * to get the latest `TokenBudgetSymbolState`.
 *
 * Communication contract:
 *   App UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly. All communication
 *   with the host flows through the injected {@link UiAppHost}.
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiAppHost,
  SlotHostMessage,
} from "@agent-type";
import { TokenProgressBar } from "./TokenProgressBar";

declare global {
  interface Window {
    __UAP_APP_HOST__?: UiAppHost;
  }
}

function waitForHost(timeout = 10000): Promise<UiAppHost> {
  return new Promise((resolve, reject) => {
    if (window.__UAP_APP_HOST__) {
      resolve(window.__UAP_APP_HOST__);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.__UAP_APP_HOST__) {
        clearInterval(interval);
        resolve(window.__UAP_APP_HOST__);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for __UAP_APP_HOST__"));
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
        "Token Budget app UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiAppHost): void {
  const slotCtx = host.getSlotContext();

  // ── Reactive store ────────────────────────────────────────────────────────

  let tbState = host.getAppState()?.[1];
  const listeners = new Set<() => void>();

  const emitChange = () => {
    tbState = host.getAppState()?.[1];
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
