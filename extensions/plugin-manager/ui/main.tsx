/**
 * extensions/plugin-manager/ui/main.tsx — Plugin Manager UI entry (iframe)
 *
 * Waits for the injected UiPluginHost, then boots the React app.
 * The host (pluginSystem.ts) populates `host.bridge` with management methods:
 *   - listPlugins()
 *   - enablePlugin(id)
 *   - disablePlugin(id)
 *   - onPluginListChanged(cb)
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` or
 *   `window.addEventListener("message")` directly. All communication
 *   with the host flows through the injected {@link UiPluginHost}.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { UiPluginHost } from "@agent-type";
import { PluginManagerPanel } from "./PluginManagerPanel";

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
    console.error("[plugin-manager-ui] Failed to get host reference:", err);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        "Plugin Manager UI failed to initialise: host reference missing." +
        "</div>";
    }
  });

function bootApp(host: UiPluginHost): void {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <PluginManagerPanel host={host} />
      </StrictMode>,
    );
  }
}
