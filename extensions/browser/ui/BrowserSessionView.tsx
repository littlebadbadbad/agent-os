import { useState, useCallback, type ReactElement, type RefObject } from 'react';
import type { BrowserEntry, BrowserTabInfo, BrowserLaunchConfig, BrowserAdapter, StreamConfig } from '../agent/index';
import { BrowserLiveView } from './BrowserLiveView';
import { BrowserPageTabs } from './BrowserPageTabs';
import { BrowserConfigPanel } from './BrowserConfigPanel';
import { BrowserVideoSettings } from './BrowserVideoSettings';
import type { BrowserPageInfo } from './BrowserLiveView';
import styles from './BrowserPanel.module.scss';

// ── Re-export for BrowserPanel ────────────────────────────────────────────────
export type { BrowserPageInfo };

// ── BrowserSessionView ────────────────────────────────────────────────────────

export interface BrowserSessionViewProps {
  entry: BrowserEntry;
  /** Browser adapter for establishing the live preview stream. */
  adapter: BrowserAdapter;
  /** Browser session id. */
  browserId: string;
  addrInput: string;
  navigating: boolean;
  /** Current page info (URL/title) — updated via onPageInfo. */
  info: BrowserPageInfo | null;
  log: string;
  jsInput: string;
  jsRunning: boolean;
  jsResult: string | null;
  consoleEndRef: RefObject<HTMLDivElement | null>;
  jsInputRef: RefObject<HTMLInputElement | null>;
  onAddrChange(v: string): void;
  onAddrFocus?(): void;
  onAddrBlur?(): void;
  /** Called on Enter-key or the ▶ button click; parent reads its own addrInput state. */
  onNavigate(): void;
  /** Called when the live stream delivers updated page info / console output. */
  onPageInfo(info: BrowserPageInfo & { consoleOutput?: string; consoleAppend?: string }): void;
  onJsChange(v: string): void;
  /** Called on Enter-key or Run button click; parent reads its own jsInput state. */
  onRunJs(): void;
  /** Called when the user clicks the proxy toggle button. */
  onToggleProxy?(): void;
  /** All tabs open in this session (from BrowserEntry or WS stream). */
  tabs: BrowserTabInfo[];
  /** Index of the currently active tab. */
  activeTabIndex: number;
  /** Called when the user clicks a tab in the page tab strip. */
  onSwitchTab?(index: number): void;
  /**
   * Called when the user applies a new launch configuration.
   * The parent is responsible for calling adapter.setLaunchConfig() and restarting.
   */
  onApplyConfig?(config: BrowserLaunchConfig): void;
  /** True while a config-triggered restart is in progress. */
  configApplying?: boolean;
  // ── Stream config & viewport ────────────────────────────────────────────
  /** Current stream configuration. */
  streamConfig?: StreamConfig;
  /** Called when the user changes FPS or quality in the video settings panel. */
  onStreamConfigChange?(config: Partial<StreamConfig>): void;
  /** Current viewport dimensions. */
  viewport?: { width: number; height: number };
  /** Called when the user drag-resizes or applies a new viewport size. */
  onViewportResize?(width: number, height: number): void;
}

export function BrowserSessionView({
  entry, adapter, browserId, addrInput, navigating, info, log,
  jsInput, jsRunning, jsResult, consoleEndRef, jsInputRef,
  onAddrChange, onAddrFocus, onAddrBlur, onNavigate, onPageInfo, onJsChange, onRunJs,
  onToggleProxy, tabs, activeTabIndex, onSwitchTab,
  onApplyConfig, configApplying = false,
  streamConfig, onStreamConfigChange, viewport, onViewportResize,
}: BrowserSessionViewProps): ReactElement {
  const [consoleHeight, setConsoleHeight] = useState(110);
  const [showConfig, setShowConfig] = useState(false);
  const [showVideoSettings, setShowVideoSettings] = useState(false);

  const handleDividerMouseDown = useCallback((e: { clientY: number; preventDefault(): void }) => {
    e.preventDefault();
    const startY      = e.clientY;
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

  return (
    <div className={styles['session-view']}>

      {/* Address / navigation bar */}
      <div className={styles['addr-bar']}>
        <button
          type="button"
          className={styles['addr-go-btn']}
          onClick={onNavigate}
          disabled={!entry.alive || navigating}
          title="Navigate"
        >
          {navigating ? '…' : '▶'}
        </button>
        <input
          className={styles['addr-input']}
          type="text"
          value={addrInput}
          onChange={e => onAddrChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onNavigate(); }}
          onFocus={e => { e.target.select(); onAddrFocus?.(); }}
          onBlur={() => onAddrBlur?.()}
          placeholder="https://example.com"
          disabled={!entry.alive || navigating}
          autoComplete="off"
          spellCheck={false}
        />
        {info?.title && (
          <span className={styles['info-title']} title={info.title ?? undefined}>
            {info.title}
          </span>
        )}
        <button
          type="button"
          className={`${styles['proxy-toggle']}${entry.useProxy ? ` ${styles['proxy-toggle--on']}` : ` ${styles['proxy-toggle--off']}`}`}
          onClick={onToggleProxy}
          disabled={!onToggleProxy}
          title={entry.useProxy ? 'Proxy ON — click to disable' : 'Proxy OFF — click to enable'}
        >
          {entry.useProxy ? 'Proxy ●' : 'Proxy ○'}
        </button>
        <button
          type="button"
          className={`${styles['cfg-btn']}${showConfig ? ` ${styles['cfg-btn--active']}` : ''}`}
          onClick={() => setShowConfig(v => !v)}
          title="Browser configuration"
        >
          ⚙️
        </button>
        <button
          type="button"
          className={`${styles['cfg-btn']}${showVideoSettings ? ` ${styles['cfg-btn--active']}` : ''}`}
          onClick={() => setShowVideoSettings(v => !v)}
          title="Video settings"
        >
          🖥
        </button>
      </div>

      {/* Config panel (collapsible) */}
      {showConfig && (
        <BrowserConfigPanel
          config={entry.launchConfig}
          applying={configApplying}
          onApply={(cfg) => { onApplyConfig?.(cfg); setShowConfig(false); }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {/* Video settings panel (collapsible) */}
      {showVideoSettings && streamConfig && onStreamConfigChange && (
        <BrowserVideoSettings
          streamConfig={streamConfig}
          onStreamConfigChange={onStreamConfigChange}
          viewport={viewport ?? { width: 1280, height: 720 }}
          onViewportChange={(w, h) => onViewportResize?.(w, h)}
          onClose={() => setShowVideoSettings(false)}
        />
      )}

      {/* Page tab strip — only visible when the session has 2+ tabs */}
      <BrowserPageTabs
        tabs={tabs}
        activeIndex={activeTabIndex}
        onSwitch={onSwitchTab ?? (() => {})}
        disabled={!entry.alive}
      />

      {/* Live browser view (canvas + stream) */}
      <BrowserLiveView
        alive={entry.alive}
        adapter={adapter}
        browserId={browserId}
        onPageInfo={onPageInfo}
        streamConfig={streamConfig}
        viewport={viewport}
        onViewportResize={onViewportResize}
      />

      {/* Drag handle — resize canvas / console split */}
      <div className={styles['resize-divider']} onMouseDown={handleDividerMouseDown} />

      {/* Console log */}
      <div className={styles['console-area']} style={{ height: consoleHeight }}>
        {log
          ? log
          : <span className={styles['console-empty']}>(no console output)</span>
        }
        <div ref={consoleEndRef} />
      </div>

      {/* JS evaluation bar */}
      <div className={styles['js-bar']}>
        <span className={styles['js-bar-label']}>JS›</span>
        <input
          ref={jsInputRef}
          className={styles['js-input']}
          type="text"
          value={jsInput}
          onChange={e => onJsChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onRunJs(); }}
          placeholder="document.title  /  window.scrollY  /  …"
          disabled={!entry.alive || jsRunning}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className={styles['js-run-btn']}
          onClick={onRunJs}
          disabled={!entry.alive || jsRunning || !jsInput.trim()}
          title="Run JS (Enter)"
        >
          {jsRunning ? '…' : 'Run'}
        </button>
      </div>

      {jsResult !== null && (
        <div className={`${styles['js-result']}${jsResult.startsWith('✗') ? ` ${styles['js-result--error']}` : ''}`}>
          {jsResult}
        </div>
      )}
    </div>
  );
}
