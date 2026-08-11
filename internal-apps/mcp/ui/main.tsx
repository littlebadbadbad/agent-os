/**
 * internal-apps/mcp/ui/main.tsx — MCP app UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads `slotContext` from `window.__UAP_APP_HOST__` to know
 *     which slot instance it's rendering.
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *
 * Communication contract:
 *   App UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly. All communication
 *   with the host flows through the injected {@link UiAppHost}.
 *
 * Unlike the old pattern, the MCP panel does NOT read data from
 * `getAppState()` — it calls agent-side methods via
 * `host.bridge` and manages its own state internally.
 * This decouples the UI from the ToolSet's in-memory state.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiAppHost,
  SlotHostMessage,
  ToolCallInfo,
  AppStateExtension,
} from "@agent-type";
import type { McpBridge } from "../agent/types";
import { McpManagerPanel } from "./McpManagerPanel";
import { McpToolCard } from "./McpToolCard";

declare global {
  interface Window {
    __UAP_APP_HOST__?: UiAppHost<AppStateExtension, McpBridge>;
  }
}

function waitForHost(timeout = 10000): Promise<UiAppHost<AppStateExtension, McpBridge>> {
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
    console.error("[mcp-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "MCP app UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiAppHost<AppStateExtension, McpBridge>): void {
  const slotCtx = host.getSlotContext();

  let toolCallInfo: ToolCallInfo | null = null;
  const toolCallListeners = new Set<() => void>();

  // ── Host→iframe messages ──────────────────────────────────────────────────

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case "toolCard":
        toolCallInfo = msg.payload.toolCallInfo ?? null;
        toolCallListeners.forEach((l) => l());
        break;
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function McpApp() {
    if (slotCtx.slotType === "toolCard") {
      if (toolCallInfo) return <McpToolCard info={toolCallInfo} />;
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          Waiting for tool call info...
        </div>
      );
    }

    return <McpManagerPanel host={host} />;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <McpApp />
      </StrictMode>,
    );
  }
}
