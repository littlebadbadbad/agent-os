/**
 * Tool State plugin UI entry (sandboxed iframe).
 */

import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiPluginHost, SlotHostMessage } from '@agent-type';
import type { ToolStateSymbolState } from '../agent/types';
import { ToolsPanel } from './ToolsPanel';

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost<ToolStateSymbolState>;
  }
}

function waitForHost(timeout = 10000): Promise<UiPluginHost<ToolStateSymbolState>> {
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
        reject(new Error('Timed out'));
      }
    }, 50);
  });
}

waitForHost()
  .then((host) => bootApp(host))
  .catch((err) => {
    console.error('[tool-state-ui] Failed:', err);
    const rootEl = document.getElementById('root');
    if (rootEl) rootEl.innerHTML =
      '<div style="padding:16px;color:#f87171;">Tool State plugin UI failed to initialise.</div>';
  });

function bootApp(host: UiPluginHost<ToolStateSymbolState>): void {
  let toolState: ToolStateSymbolState | null = host.getPluginState()?.[1] ?? null;
  const listeners = new Set<() => void>();

  const emitChange = () => {
    toolState = host.getPluginState()?.[1] ?? null;
    listeners.forEach((fn) => fn());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  const getSnapshot = (): ToolStateSymbolState | null => toolState;

  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === 'panel') emitChange();
  });

  function App(): React.ReactElement {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    if (!state) return <div style={{ padding: 16, color: '#888' }}>Loading tools...</div>;

    return (
      <ToolsPanel
        toolStates={[...state.toolStates]}
        onToggle={state.toggleTool}
      />
    );
  }

  const rootEl = document.getElementById('root');
  if (rootEl) createRoot(rootEl).render(<StrictMode><App /></StrictMode>);
}
