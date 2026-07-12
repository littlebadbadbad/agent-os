/**
 * extensions/tool-state/ui/main.tsx — Tool State plugin UI entry (iframe)
 */

import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { UiPluginHost, SlotHostMessage } from "@agent-type";
import { ToolsPanel } from "./ToolsPanel";
import type { ToolStateSymbolState } from "../agent/types";

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost;
  }
}

function waitForHost(timeout = 10000): Promise<UiPluginHost> {
  return new Promise((resolve, reject) => {
    if (window.__UAP_PLUGIN_HOST__) { resolve(window.__UAP_PLUGIN_HOST__); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.__UAP_PLUGIN_HOST__) { clearInterval(interval); resolve(window.__UAP_PLUGIN_HOST__); }
      else if (Date.now() - start > timeout) { clearInterval(interval); reject(new Error("Timed out")); }
    }, 50);
  });
}

waitForHost()
  .then((host) => { bootApp(host); })
  .catch((err) => {
    console.error("[tool-state-ui] Failed:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) rootEl.innerHTML = '<div style="padding:16px;color:#f87171;">Tool State plugin UI failed to initialise.</div>';
  });

function bootApp(host: UiPluginHost): void {
  let toolState: ToolStateSymbolState | null = null;
  const listeners = new Set<() => void>();

  const readState = () => { toolState = host.getPluginState()?.[1] ?? null; };
  readState();

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb); return () => { listeners.delete(cb); };
  };

  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === 'panel') { readState(); listeners.forEach((fn) => fn()); }
  });

  function App(): React.ReactElement {
    readState();
    useSyncExternalStore(subscribe, () => toolState, () => toolState);

    if (!toolState) return <div style={{ padding: 16, color: '#888' }}>Loading tools...</div>;

    return <ToolsPanel
      toolStates={[...toolState.toolStates]}
      onToggle={toolState.toggleTool}
    />;
  }

  const rootEl = document.getElementById("root");
  if (rootEl) createRoot(rootEl).render(<StrictMode><App /></StrictMode>);
}
