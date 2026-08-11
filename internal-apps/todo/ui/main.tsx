/**
 * internal-apps/todo/ui/main.tsx — Todo app UI entry (iframe)
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
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiAppHost,
  SlotHostMessage,
  ToolCallInfo,
} from "@agent-type";
import { TodoPanel } from "./TodoPanel";
import { TodoToolCard } from "./TodoToolCard";

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
    console.error("[todo-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Todo app UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiAppHost): void {
  const slotCtx = host.getSlotContext();

  // ── Reactive store ────────────────────────────────────────────────────────

  let todoState = host.getAppState()?.[1];
  let toolCallInfo: ToolCallInfo | null = null;
  const listeners = new Set<() => void>();

  const emitChange = () => {
    todoState = host.getAppState()?.[1];
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  const getSnapshot = () => todoState;

  // ── Host→iframe messages ──────────────────────────────────────────────────

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case "panel":
        emitChange();
        break;
      case "toolCard":
        toolCallInfo = msg.payload.toolCallInfo ?? null;
        listeners.forEach((l) => l());
        break;
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function TodoApp() {
    const state = useSyncExternalStore(subscribe, getSnapshot);
    const todos = state?.todos ?? [];

    if (slotCtx.slotType === "toolCard") {
      if (toolCallInfo) return <TodoToolCard info={toolCallInfo} />;
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          Waiting for tool call info...
        </div>
      );
    }

    // panel
    return <TodoPanel todos={todos} />;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <TodoApp />
      </StrictMode>,
    );
  }
}
