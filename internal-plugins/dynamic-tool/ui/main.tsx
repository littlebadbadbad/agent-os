/**
 * internal-plugins/dynamic-tool/ui/main.tsx — Dynamic tool plugin UI entry (iframe)
 */

import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiPluginHost, SlotHostMessage, ToolCallInfo } from '@agent-type';
import { DynamicToolCard } from './toolCard';

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
    console.error('[dynamic-tool-ui] Failed to get host reference:', err);
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        'Dynamic tool plugin UI failed to initialise: host reference missing.' +
        '</div>';
    }
  });

function bootApp(host: UiPluginHost): void {
  const slotCtx = host.getSlotContext();

  let toolCallInfo: ToolCallInfo | null = null;
  const listeners = new Set<() => void>();

  const emitChange = () => { listeners.forEach((l) => l()); };
  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };
  const getSnapshot = () => toolCallInfo;

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case 'toolCard':
        toolCallInfo = msg.payload.toolCallInfo ?? null;
        emitChange();
        break;
    }
  });

  function DynamicToolPluginApp() {
    const info = useSyncExternalStore(subscribe, getSnapshot);

    if (!info) {
      return (
        <div style={{ padding: 16, color: '#858585', fontFamily: 'system-ui' }}>
          Waiting for tool call info...
        </div>
      );
    }

    return <DynamicToolCard info={info} />;
  }

  const rootEl = document.getElementById('root');
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <DynamicToolPluginApp />
      </StrictMode>,
    );
  }
}
