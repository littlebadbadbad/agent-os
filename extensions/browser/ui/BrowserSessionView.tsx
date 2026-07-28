/**
 * extensions/browser/ui/BrowserSessionView.tsx
 *
 * Self-contained view for a single browser session.
 * Now delegates address bar and JS evaluation to dedicated sub-components.
 * Console data is provided by the parent for persistence across session switches.
 */

import { useState, useRef, useCallback, useEffect, type ReactElement } from 'react';
import type { BrowserEntry, BrowserAdapter, BrowserLaunchConfig, StreamConfig } from '../agent/types';
import type { BrowserTabInfo } from '../agent/types';
import type { BrowserPageInfo } from './BrowserLiveView';
import { BrowserLiveView } from './BrowserLiveView';
import { BrowserPageTabs } from './BrowserPageTabs';
import { BrowserAddressBar } from './BrowserAddressBar';
import { BrowserJsEvalBar } from './BrowserJsEvalBar';
import { BrowserConfigPanel } from './BrowserConfigPanel';
import { BrowserVideoSettings } from './BrowserVideoSettings';
import { BrowserConsole } from './BrowserConsole';
import styles from './BrowserPanel.module.scss';

export interface BrowserSessionViewProps {
  /** The browser session metadata. */
  entry: BrowserEntry;
  /** Browser adapter for stream + actions. */
  adapter: BrowserAdapter;
  /** Console text for the currently-active tab in this session. */
  log: string;
  /** Called when the live stream delivers updated page info / console. */
  onPageInfo(info: BrowserPageInfo): void;
  /** Called when the user clicks the proxy toggle button. */
  onToggleProxy(): void;
  /** Called when the user clicks a tab in the page tab strip. */
  onSwitchTab(index: number): void;
  /** Called when the user applies a new launch configuration. */
  onApplyConfig(config: BrowserLaunchConfig): void;
  /** True while a config-triggered restart is in progress. */
  configApplying: boolean;
  /** Current stream configuration. */
  streamConfig: StreamConfig;
  /** Called when the user changes FPS or quality. */
  onStreamConfigChange(config: Partial<StreamConfig>): void;
  /** Current viewport dimensions. */
  viewport: { width: number; height: number };
  /** Called when the user drag-resizes the viewport. */
  onViewportResize(width: number, height: number): void;
  /**
   * Called when the user types a command in the console input bar.
   * The parent should append the result to the per-tab log buffer.
   */
  onAppendToLog(text: string): void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrowserSessionView({
  entry, adapter, log,
  onPageInfo, onToggleProxy, onSwitchTab,
  onApplyConfig, configApplying,
  streamConfig, onStreamConfigChange, viewport, onViewportResize,
  onAppendToLog,
}: BrowserSessionViewProps): ReactElement {
  // ── Internal state ──────────────────────────────────────────────────────
  const [navigating, setNavigating] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(150);
  const [showConfig, setShowConfig] = useState(false);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [pageUrl, setPageUrl] = useState('');
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  // ── Derived — pull tabs/activeTab from the entry ───────────────────────
  const tabs: BrowserTabInfo[] = entry.tabs;
  const activeTabIndex = entry.activeTabIndex;

  // ── Navigate ───────────────────────────────────────────────────────────
  const handleNavigate = useCallback(async (url: string) => {
    setNavigating(true);
    try {
      await adapter.navigate(entry.id, url);
    } catch {
      // Navigation errors visible on stream.
    } finally {
      setNavigating(false);
    }
  }, [adapter, entry.id]);

  // ── Console input (REPL) — user typed a line in the input bar ─────
  const handleConsoleInput = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      onAppendToLog(`> ${trimmed}\n`);
      try {
        const result = await adapter.evaluate(entry.id, trimmed);
        const text = result === undefined
          ? 'undefined'
          : result === null
            ? 'null'
            : typeof result === 'object'
              ? JSON.stringify(result, null, 2)
              : String(result);
        onAppendToLog(`${text}\n`);
      } catch (err) {
        onAppendToLog(`\u2717 ${String(err)}\n`);
      }
    },
    [adapter, entry.id, onAppendToLog],
  );

  // ── Sync address bar from stream page info ─────────────────────────────
  const handlePageInfo = useCallback(
    (info: BrowserPageInfo) => {
      if (info.url !== undefined) {
        setPageUrl(info.url ?? '');
      }
      if (info.title !== undefined) {
        setPageTitle(info.title);
      }
      onPageInfo(info);
    },
    [onPageInfo],
  );

  // ── Reset on session switch (keyed by entry.id) ─────────────────────────
  useEffect(() => {
    setNavigating(false);
    setPageUrl('');
    setPageTitle(null);
  }, [entry.id]);

  // ── Console divider drag ──────────────────────────────────────────────
  const handleDividerMouseDown = useCallback((e: { clientY: number; preventDefault(): void }) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = consoleHeight;
    const onMove = (ev: MouseEvent) => {
      setConsoleHeight(Math.max(40, Math.min(360, startHeight + (startY - ev.clientY))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [consoleHeight]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={styles['session-view']}>

      {/* Address / navigation bar */}
      <BrowserAddressBar
        url={pageUrl}
        pageTitle={pageTitle}
        alive={entry.alive}
        useProxy={entry.useProxy}
        navigating={navigating}
        onNavigate={handleNavigate}
        onToggleProxy={onToggleProxy}
        onToggleConfig={() => setShowConfig((v) => !v)}
        onToggleVideoSettings={() => setShowVideoSettings((v) => !v)}
      />

      {/* Config panel (collapsible) */}
      {showConfig && (
        <BrowserConfigPanel
          config={entry.launchConfig}
          applying={configApplying}
          onApply={(cfg) => { onApplyConfig(cfg); setShowConfig(false); }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {/* Video settings panel (collapsible) */}
      {showVideoSettings && (
        <BrowserVideoSettings
          streamConfig={streamConfig}
          onStreamConfigChange={onStreamConfigChange}
          viewport={viewport}
          onViewportChange={(w, h) => onViewportResize(w, h)}
          onClose={() => setShowVideoSettings(false)}
        />
      )}

      {/* Page tab strip */}
      <BrowserPageTabs
        tabs={tabs}
        activeIndex={activeTabIndex}
        onSwitch={onSwitchTab}
        disabled={!entry.alive}
      />

      {/* Live browser view */}
      <BrowserLiveView
        alive={entry.alive}
        adapter={adapter}
        browserId={entry.id}
        onPageInfo={handlePageInfo}
        streamConfig={streamConfig}
        viewport={viewport}
        onViewportResize={onViewportResize}
      />

      {/* Console resize divider */}
      <div className={styles['resize-divider']} onMouseDown={handleDividerMouseDown} />

      {/* Console — per-tab isolated, with inline REPL input */}
      <div className={styles['console-area']} style={{ height: consoleHeight }}>
        {log
          ? (
            <BrowserConsole
              text={log}
              tabKey={`${entry.id}-${activeTabIndex}`}
              onInput={handleConsoleInput}
            />
          )
          : <span className={styles['console-empty']}>(no console output)</span>
        }
      </div>

      {/* JS evaluation bar */}
      <BrowserJsEvalBar
        adapter={adapter}
        browserId={entry.id}
        alive={entry.alive}
      />
    </div>
  );
}
