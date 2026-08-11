/**
 * internal-apps/devops/ui/main.tsx — DevOps app UI entry (app slot iframe)
 *
 * Slot-driven rendering:
 *   - Reads host from `window.__UAP_APP_HOST__`
 *   - Creates the UiBridge and populates the shared bridge object
 *   - Renders the DevOps React app
 *
 * Communication contract:
 *   App UI code MUST NOT use `window.parent.postMessage()` directly.
 *   All host communication flows through the injected UiAppHost.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiAppHost, AppStateExtension } from '@agent-type';
import type { DevOpsBridge } from './types';
import { populateDevopsBridge } from './bridge';
import { setApiClient } from './api/client';
import DevOpsApp from './components/DevOpsApp';


function waitForHost(timeout = 10000): Promise<UiAppHost<AppStateExtension, DevOpsBridge>> {
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
        reject(new Error('Timed out waiting for __UAP_APP_HOST__'));
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
        'DevOps app UI failed to initialise: host reference missing.' +
        '</div>';
    }
  });

function bootApp(host: UiAppHost<AppStateExtension, DevOpsBridge>): void {
  // Populate the shared bridge so agent tools can interact with UI state
  populateDevopsBridge(host.bridge);

  // Set the API client so all domain API modules use AppApiClient
  setApiClient(host.apiClient);

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <DevOpsApp />
    </StrictMode>,
  );
}
