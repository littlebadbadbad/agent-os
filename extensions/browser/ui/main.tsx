import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  UiPluginHost,
  UapPluginMessage,
  ToolCallInfo,
  PluginStateExtension,
  AgentSessionExtension,
  AgentSessionState,
} from "@agent-type";
import type { BrowserAdapter } from "../agent/index";
import { BrowserPanel } from "./BrowserPanel";
import { BrowserToolCard } from "./BrowserToolCard";
import { BROWSER_SYMBOL } from "../agent/toolSet";

// ── Host reference ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost;
  }
}

// ── Wait for host asynchronously ──────────────────────────────────────────────
//
// The parent injects `window.__UAP_PLUGIN_HOST__` on the iframe `load`
// event.  This script runs before that event fires, so we poll until the
// reference appears.

function waitForHost(timeout = 10000): Promise<UiPluginHost> {
  return new Promise((resolve, reject) => {
    // Fast path: already available.
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

// ── Boot ──────────────────────────────────────────────────────────────────────

waitForHost()
  .then((host) => {
    bootApp(host);
  })
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

// ── App bootstrap ─────────────────────────────────────────────────────────────

function bootApp(host: UiPluginHost): void {
  // ── External store for host messages ──────────────────────────────────────
  //
  // We use useSyncExternalStore to subscribe to host messages and trigger
  // re-renders when state updates arrive. The store holds a monotonically
  // increasing tick counter; components read host.sessionState directly.

  let browserState: Partial<PluginStateExtension> = host.sessionState?.[BROWSER_SYMBOL] ?? {};
  let sessionState: AgentSessionState | undefined = host.sessionState
  const listeners = new Set<() => void>();
  debugger

  const emitChange = (state: AgentSessionState) => {
    browserState = state[BROWSER_SYMBOL];
    sessionState = state;
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  const getSnapshot = () => browserState;

  // ToolCard mode state — set when a `toolCallInfo` message arrives.
  let toolCallInfo: ToolCallInfo | null = null;

  // Subscribe to host messages (Link B).
  host.onHostMessage((msg: UapPluginMessage) => {
    switch (msg.type) {
      case "stateUpdate":
        // Session state changed — host.sessionState is already updated
        // (direct same-realm reference). Just trigger a re-render.
        emitChange(msg.payload);
        break;

      case "toolCallInfo":
        // Switch to toolCard mode with the provided tool call info.
        toolCallInfo = msg.payload ?? null;
        break;
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function BrowserPluginApp() {
    const { browserAdapter } = useSyncExternalStore(subscribe, getSnapshot);

    // ToolCard mode takes priority.
    if (toolCallInfo) {
      return <BrowserToolCard info={toolCallInfo} />;
    }

    // Main panel mode — read the adapter from session state.

    if (!browserAdapter) {
      return (
        <div style={{ padding: 16, color: "#858585", fontFamily: "system-ui" }}>
          Browser adapter not available in this session.
        </div>
      );
    }

    return (
      <BrowserPanel adapter={browserAdapter} sessionId={sessionState!.id} />
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

    // Report initial size to host (Link A), then observe changes.
    const reportSize = () => {
      const rect = document.body.getBoundingClientRect();
      host.postMessage({
        version: 1,
        type: "resize",
        payload: { width: rect.width, height: rect.height },
      });
    };

    // Report after initial render.
    requestAnimationFrame(reportSize);

    // Observe subsequent size changes.
    const resizeObserver = new ResizeObserver(() => reportSize());
    resizeObserver.observe(document.body);
  }
}
