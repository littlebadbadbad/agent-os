/**
 * extensions/devops/ui/main.tsx — DevOps plugin UI entry (app slot iframe)
 *
 * Slot-driven rendering:
 *   - Reads host from `window.__UAP_PLUGIN_HOST__`
 *   - Creates the UiBridge and populates the shared bridge object
 *   - Renders the DevOps React app
 *
 * Communication contract:
 *   Plugin UI code MUST NOT use `window.parent.postMessage()` directly.
 *   All host communication flows through the injected UiPluginHost.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiPluginHost, PluginStateExtension } from '@agent-type';
import type { DevOpsBridge } from './types';
import { populateDevopsBridge } from './bridge';
import { setApiClient } from './api/client';
import DevOpsApp from './components/DevOpsApp';


function waitForHost(timeout = 10000): Promise<UiPluginHost<PluginStateExtension, DevOpsBridge>> {
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
        reject(new Error('Timed out waiting for __UAP_PLUGIN_HOST__'));
      }
    }, 50);
  });
}

waitForHost()
  .then((host) => { bootApp(host); })
  .catch((err) => {
    console.error('[devops-ui] Failed to get host reference:', err);
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        'DevOps plugin UI failed to initialise: host reference missing.' +
        '</div>';
    }
  });

function bootApp(host: UiPluginHost<PluginStateExtension, DevOpsBridge>): void {
  // Populate the shared bridge so agent tools can interact with UI state
  populateDevopsBridge(host.bridge);

  // Set the API client so all domain API modules use PluginApiClient
  setApiClient(host.apiClient);

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <DevOpsApp />
    </StrictMode>,
  );
}
