/**
 * internal-plugins/terminal/ui/main.tsx — Terminal plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - App slot: creates a TerminalManagerAdapter from the API client (no agent state)
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
import { createTerminalUiAdapter } from "../agent/shell/pluginAdapter";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalToolCard } from "./TerminalToolCard";

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
    console.error("[terminal-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Terminal plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  // ── Create UI-side adapter directly from API client (no agent state) ────
  const adapter = createTerminalUiAdapter(host.apiClient);

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
  function TerminalPluginApp() {
    if (slotCtx.slotType === "toolCard") {
      return toolCallInfo
        ? <TerminalToolCard info={toolCallInfo} />
        : (
          <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
            Waiting for tool call info...
          </div>
        );
    }

    // App slot: render with self-made adapter.
    return <TerminalPanel adapter={adapter} sessionId="" />;
  }

  // ── Mount ────────────────────────────────────────────────────────────────
  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <TerminalPluginApp />
      </StrictMode>,
    );
  }
}
