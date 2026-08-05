/**
 * internal-plugins/browser/ui/main.tsx — Browser plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - App slot: creates a BrowserAdapter from the API client (no agent state)
 *   - ToolCard slot: receives tool call info via host messages
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly. All communication
 *   with the host flows through the injected UiPluginHost.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { UiPluginHost, SlotHostMessage, ToolCallInfo } from "@agent-type";
import { createBrowserUiAdapter } from "../agent/pluginAdapter";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserToolCard } from "./BrowserToolCard";

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

  // ── Create UI-side adapter directly from API client (no agent state) ────
  const adapter = createBrowserUiAdapter(host.apiClient);

  // ── Tool card message handling ───────────────────────────────────────────
  let toolCallInfo: ToolCallInfo | null = null;
  const toolCardListeners = new Set<() => void>();

  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === "toolCard") {
      toolCallInfo = msg.payload.toolCallInfo ?? null;
      toolCardListeners.forEach((l) => l());
    }
    // App slot doesn't need state messages — we have our own adapter.
  });

  // ── App component ────────────────────────────────────────────────────────
  function BrowserPluginApp() {
    if (slotCtx.slotType === "toolCard") {
      return toolCallInfo
        ? <BrowserToolCard info={toolCallInfo} />
        : (
          <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
            Waiting for tool call info...
          </div>
        );
    }

    // App slot (and any other non-toolCard slot): render with self-made adapter.
    return <BrowserPanel adapter={adapter} />;
  }

  // ── Mount ────────────────────────────────────────────────────────────────
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
