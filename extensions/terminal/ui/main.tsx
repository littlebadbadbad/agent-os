/**
 * extensions/terminal/ui/main.tsx — Terminal plugin UI entry (iframe)
 *
 * Slot-driven rendering using the UiPluginHost pattern (same as browser):
 *   - Reads slotContext from host.getSlotContext()
 *   - Subscribes to host→iframe messages via host.onSlotMessage()
 *   - Accesses plugin state (adapter) via host.getPluginState()
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use window.parent.postMessage() or
 *   window.addEventListener("message") directly.  All communication
 *   flows through the injected UiPluginHost.
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  SlotHostMessage,
  ToolCallInfo,
  PluginStateExtension,
  PluginUiAdapter,
} from "@agent-type";
import type { TerminalManagerAdapter } from "../agent/shell/types";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalToolCard } from "./TerminalToolCard";

// ── Terminal-specific plugin state ─────────────────────────────────────────

interface TerminalPluginState extends PluginStateExtension {
  readonly type: "terminal";
  readonly terminalAdapter: TerminalManagerAdapter;
}

type Host = UiPluginHost<TerminalPluginState>;

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: Host;
  }
}

function waitForHost(timeout = 10000): Promise<Host> {
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

function bootApp(host: Host): void {
  const slotCtx = host.getSlotContext();

  // ── Reactive store ──────────────────────────────────────────────────────

  let terminalState: (TerminalPluginState & PluginUiAdapter) | null = null;
  let sessionState = host.getPluginState()?.[0] ?? null;
  const listeners = new Set<() => void>();

  function readState(): (TerminalPluginState & PluginUiAdapter) | null {
    return host.getPluginState()?.[1] ?? null;
  }

  terminalState = readState();

  const emitChange = () => {
    const state = host.getPluginState();
    sessionState = state?.[0] ?? null;
    terminalState = readState();
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  const getSnapshot = () => terminalState;

  let toolCallInfo: ToolCallInfo | null = null;

  // ── Host→iframe messages ────────────────────────────────────────────────

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

  // ── App component ────────────────────────────────────────────────────────

  function TerminalPluginApp() {
    const state = useSyncExternalStore(subscribe, getSnapshot);
    const terminalAdapter: TerminalManagerAdapter | undefined =
      state?.terminalAdapter;

    if (toolCallInfo) {
      return <TerminalToolCard info={toolCallInfo} />;
    }

    if (!terminalAdapter) {
      return (
        <div style={{ padding: 16, color: "#8b949e" }}>
          Terminal adapter not available.
        </div>
      );
    }

    return (
      <TerminalPanel
        adapter={terminalAdapter}
        sessionId={sessionState?.id ?? "unknown"}
      />
    );
  }

  const rootEl = document.getElementById("root");
  if (!rootEl) return;

  createRoot(rootEl).render(
    <StrictMode>
      <TerminalPluginApp />
    </StrictMode>,
  );
}
