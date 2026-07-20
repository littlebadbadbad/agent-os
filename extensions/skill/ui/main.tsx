/**
 * extensions/skill/ui/main.tsx — Skill plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads `slotContext` from `window.__UAP_PLUGIN_HOST__` to know
 *     which slot instance it's rendering.
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly. All communication
 *   with the host flows through the injected {@link UiPluginHost}.
 *
 * Unlike the old pattern, the Skill panel does NOT read data from
 * `getPluginState()` — it calls agent-side APIs via
 * `host.callAgentApi()` and manages its own state internally.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  SlotHostMessage,
  ToolCallInfo,
} from "@agent-type";
import { SkillManagerPanel } from "./SkillManagerPanel";
import { SkillToolCard } from "./SkillToolCard";

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
    console.error("[skill-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Skill plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
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

  function SkillPluginApp() {
    if (slotCtx.slotType === "toolCard") {
      if (toolCallInfo) return <SkillToolCard info={toolCallInfo} />;
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          Waiting for tool call info...
        </div>
      );
    }

    return <SkillManagerPanel host={host} />;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <SkillPluginApp />
      </StrictMode>,
    );
  }
}
