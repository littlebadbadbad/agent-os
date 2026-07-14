/**
 * extensions/plan/ui/main.tsx — Plan plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads `slotContext` from `window.__UAP_PLUGIN_HOST__` to know
 *     which slot instance it's rendering.
 *   - Receives host→iframe messages via `host.onSlotMessage()`.
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly.
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  SlotHostMessage,
  ToolCallInfo,
} from "@agent-type";
import { PlanPanel } from "./PlanPanel";
import { PlanToolCard } from "./PlanToolCard";
import type { PlanSymbolState, PlanToolResult } from "../agent/types";
import { PLAN_TOOL_NAMES } from "../agent/types";

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost;
  }
}

// ── Boundary narrowing: host→plugin ToolCallInfo type crossing ────────────────

/**
 * Type predicate: validates that a {@link ToolCallInfo} (with `unknown` result
 * from the host) is actually a plan tool call, narrowing to the typed
 * `ToolCallInfo<PlanToolResult>`.
 *
 * This is the single point where the protocol boundary's `unknown → typed`
 * crossing occurs — verified at runtime by matching the tool name against
 * the set of known plan tools.
 */
function isPlanToolCallInfo(
  info: ToolCallInfo,
): info is ToolCallInfo<PlanToolResult> {
  return PLAN_TOOL_NAMES.has(info.name);
}

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
    console.error("[plan-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Plan plugin UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  // ── Reactive store ────────────────────────────────────────────────────────

  let planState: PlanSymbolState | null = null;
  let toolCallInfo: ToolCallInfo<PlanToolResult> | null = null;
  const listeners = new Set<() => void>();

  const emitChange = () => {
    planState = host.getPluginState()?.[1] ?? null;
    listeners.forEach((fn) => fn());
  };

  const readState = () => {
    const state = host.getPluginState();
    // state is [SessionStateLike, PlanSymbolState & PluginUiAdapter]
    planState = state?.[1] ?? null;
  };

  readState();

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  // Listen for host→iframe messages (slot-specific).
  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case "panel":
        emitChange();
        break;
      case "toolCard": {
        const raw = msg.payload.toolCallInfo ?? null;
        // Narrow from ToolCallInfo<unknown> → ToolCallInfo<PlanToolResult>
        // via runtime name validation — zero `as` casts.
        toolCallInfo = raw && isPlanToolCallInfo(raw) ? raw : null;
        listeners.forEach((fn) => fn());
        break;
      }
    }
  });

  function PlanApp(): React.ReactElement {
    readState();

    // ── toolCard ──────────────────────────────────────────────────────────
    if (slotCtx.slotType === "toolCard") {
      if (toolCallInfo) return <PlanToolCard info={toolCallInfo} />;
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          No plan tool call data available.
        </div>
      );
    }

    // ── panel (default) ───────────────────────────────────────────────────
    const _version = useSyncExternalStore(
      subscribe,
      () => planState,
      () => planState,
    );

    if (!planState || !planState.plan) {
      return <div style={{ padding: 16, color: '#888' }}>No plan yet.</div>;
    }

    return <PlanPanel plan={planState.plan} />;
  }

  const rootEl = document.getElementById("root");
  if (rootEl) {
    createRoot(rootEl).render(
      <StrictMode>
        <PlanApp />
      </StrictMode>,
    );
  }
}
