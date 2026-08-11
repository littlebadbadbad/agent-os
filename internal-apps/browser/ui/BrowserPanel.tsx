/**
 * internal-apps/browser/ui/BrowserPanel.tsx — Browser app app panel (app slot)
 *
 * Lean orchestrator backed by the unified useBrowserStore hook.
 * Owns only the new-session creation bar state; everything else lives in the store.
 */

import { useState, useRef, useCallback, type ReactElement } from 'react';
import type { BrowserAdapter, BrowserLaunchConfig } from '../agent/types';
import type { BrowserPageInfo } from './BrowserLiveView';
import { useBrowserStore } from './hooks/useBrowserStore';
import { BrowserTabBar } from './BrowserTabBar';
import { BrowserSessionView } from './BrowserSessionView';
import styles from './BrowserPanel.module.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrowserPanelProps {
  adapter: BrowserAdapter;
}

export type { BrowserPageInfo };

// ── Component ─────────────────────────────────────────────────────────────────

export function BrowserPanel({ adapter }: BrowserPanelProps): ReactElement {
  const store = useBrowserStore(adapter);
  const storeRef = useRef(store);
  storeRef.current = store;

  // New-session creation bar state (local to panel, no need to persist).
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [showNewBar, setShowNewBar] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [newSessionConfig, setNewSessionConfig] = useState<BrowserLaunchConfig>({});

  const handlePageInfo = useCallback(
    (browserId: string, info: BrowserPageInfo) => {
      const s = storeRef.current;
      const tabIdx = info.activeTabIndex ?? 0;

      if (info.consoleOutput !== undefined) {
        s.setConsoleOutput(browserId, tabIdx, info.consoleOutput);
      }
      if (info.consoleAppend) {
        s.appendConsoleOutput(browserId, tabIdx, info.consoleAppend);
      }
      if (info.activeTabIndex !== undefined) {
        s.setActiveTab(browserId, info.activeTabIndex);
      }
      if (info.tabs !== undefined && info.activeTabIndex !== undefined) {
        s.updateTabInfo(browserId, info.tabs, info.activeTabIndex);
      }
    },
    [],
  );

  // ── Derive active console text ──────────────────────────────────────────

  const activeEntry = store.selectedEntry;
  const activeTabIdx = activeEntry
    ? (store.activeTabBySession[activeEntry.id] ?? activeEntry.activeTabIndex ?? 0)
    : 0;
  const activeLog = activeEntry
    ? store.getLog(activeEntry.id, activeTabIdx)
    : '';

  const handleAppendToLog = useCallback(
    (text: string) => {
      const s = storeRef.current;
      const id = s.selectedEntry?.id;
      if (!id) return;
      const tabIdx = s.activeTabBySession[id] ?? 0;
      s.appendConsoleOutput(id, tabIdx, text);
    },
    [],
  );

  // ── Viewport resize ────────────────────────────────────────────────────

  const handleViewportResize = useCallback(
    (w: number, h: number) => {
      const s = storeRef.current;
      s.updateViewport(w, h);
      const entry = s.selectedEntry;
      if (entry) s.setViewportSize(entry.id, w, h);
    },
    [],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={styles['panel']}>
      <BrowserTabBar
        sessions={store.sessions}
        selectedId={store.selectedId}
        creating={store.creating}
        showNewBar={showNewBar}
        urlInput={urlInput}
        useProxy={useProxy}
        newSessionConfig={newSessionConfig}
        urlInputRef={urlInputRef}
        onSelect={store.select}
        onClose={store.close}
        onCreate={(url) => store.create(url, useProxy, newSessionConfig)}
        onShowNewBar={setShowNewBar}
        onUrlChange={setUrlInput}
        onUseProxyChange={setUseProxy}
        onNewSessionConfigChange={setNewSessionConfig}
      />

      {activeEntry ? (
        <BrowserSessionView
          key={activeEntry.id}
          entry={activeEntry}
          adapter={adapter}
          log={activeLog}
          onPageInfo={(info) => handlePageInfo(activeEntry.id, info)}
          onToggleProxy={() => store.toggleProxy(activeEntry.id)}
          onSwitchTab={(idx) => store.switchTab(activeEntry.id, idx)}
          onApplyConfig={(cfg) => store.applyConfig(activeEntry.id, cfg)}
          configApplying={store.configApplying}
          streamConfig={store.streamConfig}
          onStreamConfigChange={store.updateStreamConfig}
          viewport={store.viewport}
          onViewportResize={handleViewportResize}
          onAppendToLog={handleAppendToLog}
        />
      ) : (
        <div className={styles['empty-state']}>
          <div className={styles['empty-icon']}>{String.fromCodePoint(0x1F310)}</div>
          <div className={styles['empty-msg']}>No browser sessions open</div>
          <div className={styles['empty-hint']}>
            Click <strong>+</strong> to launch a new Playwright browser session
          </div>
        </div>
      )}
    </div>
  );
}
