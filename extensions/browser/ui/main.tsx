/**
 * extensions/browser/ui/main.tsx — Browser plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads `slotContext` from `window.__UAP_PLUGIN_HOST__` to know
 *     which slot instance it's rendering.
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *   - Sends iframe→host messages via `host.sendSlotMessage()`.
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
  ToolCallInfo,
} from "@agent-type";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserToolCard } from "./BrowserToolCard";
import { BrowserCompactToolCard } from "./BrowserCompactToolCard";

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
    console.error("[browser-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Browser plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  // In compact mode, allow the body to shrink-wrap its content so the
  // iframe can report the actual content height to the host.
  if (slotCtx.slotType === "compactToolCard") {
    document.body.classList.add("compact-mode");
  }

  // ── Reactive store ────────────────────────────────────────────────────────

  let sessionState = host.getPluginState()?.[0] ?? null;
  let browserState = host.getPluginState()?.[1] ?? null;
  const listeners = new Set<() => void>();

  const emitChange = () => {
    const state = host.getPluginState();
    sessionState = state?.[0] ?? null;
    browserState = state?.[1] ?? null;
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  const getSnapshot = () => browserState;

  let toolCallInfo: ToolCallInfo | null = null;

  // ── Host→iframe messages ──────────────────────────────────────────────────
  //
  // The host pushes SlotHostMessage payloads via `host._pushToIframe()`,
  // which delivers them to our `onSlotMessage` callback. Messages sent
  // before we register this subscriber are buffered by the host and
  // replayed on registration, so we never miss the initial toolCallInfo.

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case "panel":
        emitChange();
        break;
      case "toolCard":
      case "compactToolCard":
        toolCallInfo = msg.payload.toolCallInfo ?? null;
        listeners.forEach((l) => l());
        break;
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function BrowserPluginApp() {
    const state = useSyncExternalStore(subscribe, getSnapshot);
    const browserAdapter = state?.browserAdapter;

    if (slotCtx.slotType === "compactToolCard") {
      if (toolCallInfo) return <BrowserCompactToolCard info={toolCallInfo} host={host} />;
      return null;
    }

    if (slotCtx.slotType === "toolCard") {
      if (toolCallInfo) return <BrowserToolCard info={toolCallInfo} />;
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          Waiting for tool call info...
        </div>
      );
    }

    if (!browserAdapter) {
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          Browser adapter not available in this session.
        </div>
      );
    }

    return (
      <BrowserPanel adapter={browserAdapter} sessionId={sessionState?.id ?? "unknown"} />
    );
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <BrowserPluginApp />
      </StrictMode>,
    );

  }
}
