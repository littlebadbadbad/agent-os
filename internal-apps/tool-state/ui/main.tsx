/**
 * Tool State app UI entry (sandboxed iframe).
 *
 * One bundle serves two slots, branched on `slotContext.slotType`:
 *
 *  - `panel`      — per-session view driven by host-pushed app state
 *                   (`getAppState()`), refreshed on every `panel` message.
 *  - `toolButton` — session-INDEPENDENT global view driven by the app
 *                   bridge (MCP pattern): `getAppState()` is `undefined`
 *                   without an active session, so the dropdown reads the
 *                   global tool pool through `host.bridge` and re-renders
 *                   via `subscribeGlobal`.
 */

import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiAppHost, SlotHostMessage } from '@agent-type';
import type { ToolStateBridge } from '../agent/bridge';
import type { ToolStateSymbolState } from '../agent/types';
import { ToolsPanel } from './ToolsPanel';
import { GlobalToolsPanel } from './GlobalToolsPanel';
import styles from './styles.module.scss';

declare global {
  interface Window {
    __UAP_APP_HOST__?: UiAppHost<ToolStateSymbolState, ToolStateBridge>;
  }
}

function waitForHost(timeout = 10000): Promise<UiAppHost<ToolStateSymbolState, ToolStateBridge>> {
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
    if (rootEl) {
      const box = document.createElement('div');
      box.className = styles['boot-error'];
      box.textContent = 'Tool State app UI failed to initialise.';
      rootEl.appendChild(box);
    }
  });

function bootApp(host: UiAppHost<ToolStateSymbolState, ToolStateBridge>): void {
  const slotType = host.getSlotContext().slotType;
  const rootEl = document.getElementById('root');
  if (!rootEl) return;

  // ── Global control (toolButton): bridge-driven, works with no session ──
  if (slotType === 'toolButton') {
    const bridge = host.bridge;
    let version = 0;
    const listeners = new Set<() => void>();
    const bump = (): void => {
      version += 1;
      listeners.forEach((fn) => fn());
    };
    bridge.subscribeGlobal(bump);
    // Session pushes also bump: newly registered tools change the global pool.
    host.onSlotMessage((msg: SlotHostMessage) => {
      if (msg.type === 'toolButton') bump();
    });

    const subscribe = (cb: () => void): (() => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    };

    function GlobalApp(): React.ReactElement {
      useSyncExternalStore(subscribe, () => version, () => version);
      return <GlobalToolsPanel bridge={bridge} version={version} />;
    }

    createRoot(rootEl).render(<StrictMode><GlobalApp /></StrictMode>);
    return;
  }

  // ── Per-session panel: host-pushed symbol state ──────────────────────────
  let toolState: ToolStateSymbolState | null = host.getAppState()?.[1] ?? null;
  const listeners = new Set<() => void>();

  const emitChange = (): void => {
    toolState = host.getAppState()?.[1] ?? null;
    listeners.forEach((fn) => fn());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };

  const getSnapshot = (): ToolStateSymbolState | null => toolState;

  host.onSlotMessage((msg: SlotHostMessage) => {
    if (msg.type === 'panel') emitChange();
  });

  function App(): React.ReactElement {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    if (!state) return <div className={styles['panel-loading']}>Loading tools...</div>;

    return (
      <ToolsPanel
        toolStates={[...state.toolStates]}
        onToggle={state.toggleTool}
      />
    );
  }

  createRoot(rootEl).render(<StrictMode><App /></StrictMode>);
}
