/**
 * extensions/browser/ui/BrowserPanel.tsx — Browser plugin app panel (app slot)
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

  // New-session creation bar state (local to panel, no need to persist).
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [showNewBar, setShowNewBar] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [newSessionConfig, setNewSessionConfig] = useState<BrowserLaunchConfig>({});

  // ── Stream callback — routes console + tab info ─────────────────────────

  const handlePageInfo = useCallback(
    (browserId: string, info: BrowserPageInfo) => {
      const tabIdx = info.activeTabIndex ?? 0;

      if (info.consoleOutput !== undefined) {
        store.setConsoleOutput(browserId, tabIdx, info.consoleOutput);
      }
      if (info.consoleAppend) {
        store.appendConsoleOutput(browserId, tabIdx, info.consoleAppend);
      }
      if (info.activeTabIndex !== undefined) {
        store.setActiveTab(browserId, info.activeTabIndex);
      }
      if (info.tabs !== undefined && info.activeTabIndex !== undefined) {
        store.updateTabInfo(browserId, info.tabs, info.activeTabIndex);
      }
    },
    [store],
  );

  // ── Derive active console text ──────────────────────────────────────────

  const activeEntry = store.selectedEntry;
  const activeTabIdx = activeEntry
    ? (store.activeTabBySession[activeEntry.id] ?? activeEntry.activeTabIndex ?? 0)
    : 0;
  const activeLog = activeEntry
    ? store.getLog(activeEntry.id, activeTabIdx)
    : '';

  // ── Console REPL ────────────────────────────────────────────────────────

  const handleAppendToLog = useCallback(
    (text: string) => {
      if (!activeEntry) return;
      store.appendConsoleOutput(activeEntry.id, activeTabIdx, text);
    },
    [store, activeEntry, activeTabIdx],
  );

  // ── Viewport resize ────────────────────────────────────────────────────

  const handleViewportResize = useCallback(
    (w: number, h: number) => {
      store.updateViewport(w, h);
      if (activeEntry) store.setViewportSize(activeEntry.id, w, h);
    },
    [store, activeEntry],
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
