/**
 * internal-plugins/file/ui/main.tsx — File plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - app slot: renders FilePanelApp (multi-workspace file browser/editor)
 *   - toolCard slot: renders FileToolCard with tool call info from host
 *
 * Communication contract:
 *   All host↔iframe communication flows through the injected
 *   window.__UAP_PLUGIN_HOST__. Do NOT use postMessage.
 */

import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiPluginHost, SlotHostMessage, ToolCallInfo } from '@agent-type';
import { FileToolCard } from './toolCard';
import { createFileWorkspaceApi } from './api/workspaceApi';
import { FilePanelApp } from './panel/FilePanelApp';

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
        reject(new Error('Timed out waiting for __UAP_PLUGIN_HOST__'));
      }
    }, 50);
  });
}

waitForHost()
  .then((host) => { bootApp(host); })
  .catch((err) => {
    console.error('[file-ui] Failed to get host reference:', err);
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        'File plugin UI failed to initialise: host reference missing.' +
        '</div>';
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  // ── Reactive store ────────────────────────────────────────────────────────

  let toolCallInfo: ToolCallInfo | null = null;
  const listeners = new Set<() => void>();

  const emitChange = () => { listeners.forEach((l) => l()); };
  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };
  const getSnapshot = () => toolCallInfo;

  // ── Host→iframe messages ──────────────────────────────────────────────────

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case 'toolCard':
        toolCallInfo = msg.payload.toolCallInfo ?? null;
        emitChange();
        break;
    }
  });

  // ── App component ──────────────────────────────────────────────────────────

  function FilePluginApp() {
    const info = useSyncExternalStore(subscribe, getSnapshot);

    if (slotCtx.slotType === 'app') {
      const api = createFileWorkspaceApi(host.apiClient);
      return <FilePanelApp api={api} />;
    }

    if (!info) {
      return (
        <div style={{ padding: 16, color: '#858585', fontFamily: 'system-ui' }}>
          Waiting for tool call info...
        </div>
      );
    }

    return <FileToolCard info={info} />;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  const rootEl = document.getElementById('root');
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <FilePluginApp />
      </StrictMode>,
    );
  }
}
