/**
 * internal-plugins/experience/ui/main.tsx — Experience plugin UI entry (iframe)
 *
 * Slot-driven rendering:
 *   - Reads slotContext from window.__UAP_PLUGIN_HOST__ to know
 *     which slot instance it's rendering.
 *   - Receives host->iframe messages via host.onSlotMessage().
 */

import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { UiPluginHost, SlotHostMessage, ToolCallInfo } from '@agent-type';
import type { ExperienceSymbolState } from '../agent/types';
import { ExperiencePanel } from './ExperiencePanel';
import { ExperienceToolCard } from './ExperienceToolCard';

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost<ExperienceSymbolState>;
  }
}

function waitForHost(timeout = 10000): Promise<UiPluginHost<ExperienceSymbolState>> {
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
  .then((host) => bootApp(host))
  .catch((err) => {
    console.error('[experience-ui] Failed to get host reference:', err);
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="padding:16px;color:#f87171;font-family:system-ui;">' +
        'Experience plugin UI failed to initialise: host reference missing.' +
        '</div>';
    }
  });

function bootApp(host: UiPluginHost<ExperienceSymbolState>): void {
  const slotCtx = host.getSlotContext();

  let expState: ExperienceSymbolState | null = host.getPluginState()?.[1] ?? null;
  const listeners = new Set<() => void>();

  const emitChange = () => {
    const state = host.getPluginState();
    expState = state?.[1] ?? null;
    listeners.forEach((l) => l());
  };

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  const getSnapshot = () => expState;

  let toolCallInfo: ToolCallInfo | null = null;

  host.onSlotMessage((msg: SlotHostMessage) => {
    switch (msg.type) {
      case 'panel':
        emitChange();
        break;
      case 'toolCard':
        toolCallInfo = msg.payload.toolCallInfo ?? null;
        listeners.forEach((l) => l());
        break;
    }
  });

  function ExperiencePluginApp() {
    const state = useSyncExternalStore(subscribe, getSnapshot);
    const experiences = state?.experiences ?? [];
    const experienceStore = state?.experienceStore;

    if (slotCtx.slotType === 'toolCard') {
      if (toolCallInfo) return <ExperienceToolCard info={toolCallInfo} />;
      return (
        <div style={{ padding: 16, color: '#858585', fontFamily: 'system-ui' }}>
          Waiting for tool call info...
        </div>
      );
    }

    return (
      <ExperiencePanel
        experiences={experiences}
        experienceStore={experienceStore}
      />
    );
  }

  const rootEl = document.getElementById('root');
  if (rootEl) {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <ExperiencePluginApp />
      </StrictMode>,
    );
  }
}
