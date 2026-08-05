import { useState, type ReactElement, type RefObject } from 'react';
import type { BrowserEntry, BrowserLaunchConfig } from '../agent/index';
import { BrowserConfigPanel } from './BrowserConfigPanel';
import styles from './BrowserPanel.module.scss';

// ── BrowserTabBar ─────────────────────────────────────────────────────────────

export interface BrowserTabBarProps {
  sessions: BrowserEntry[];
  selectedId: string | null;
  creating: boolean;
  showNewBar: boolean;
  urlInput: string;
  useProxy: boolean;
  /** Launch config applied when creating a new session. */
  newSessionConfig: BrowserLaunchConfig;
  urlInputRef: RefObject<HTMLInputElement | null>;
  onSelect(id: string): void;
  onClose(id: string): void;
  onCreate(startUrl?: string): void;
  onShowNewBar(show: boolean): void;
  onUrlChange(v: string): void;
  onUseProxyChange(v: boolean): void;
  onNewSessionConfigChange(config: BrowserLaunchConfig): void;
}

export function BrowserTabBar({
  sessions, selectedId, creating, showNewBar, urlInput, useProxy, newSessionConfig, urlInputRef,
  onSelect, onClose, onCreate, onShowNewBar, onUrlChange, onUseProxyChange, onNewSessionConfigChange,
}: BrowserTabBarProps): ReactElement {
  const [showNewConfig, setShowNewConfig] = useState(false);
  return (
    <div className={styles['tab-bar-wrap']}>
      <div className={styles['tab-bar']}>
      <span className={styles['tab-bar-title']}>Browser</span>

      {sessions.map(s => (
        <button
          key={s.id}
          type="button"
          className={`${styles['tab']}${s.id === selectedId ? ` ${styles['tab--active']}` : ''}`}
          onClick={() => onSelect(s.id)}
          title={`${s.url ?? s.label}${s.useProxy ? ' · proxy on' : ' · proxy off'}`}
        >
          <span
            className={`${styles['tab-dot']}${
              s.alive ? ` ${styles['tab-dot--alive']}` : ` ${styles['tab-dot--closed']}`
            }`}
          />
          <span className={styles['tab-label']}>{s.label}</span>
          {!s.useProxy && (
            <span className={styles['tab-proxy-off']} title="Proxy disabled">⊘</span>
          )}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
          <span
            className={styles['tab-close']}
            role="button"
            tabIndex={-1}
            title="Close session"
            onClick={e => { e.stopPropagation(); onClose(s.id); }}
          >
            ×
          </span>
        </button>
      ))}

      {showNewBar ? (
        <div className={styles['new-bar']}>
          <input
            ref={urlInputRef}
            className={styles['new-bar-input']}
            type="text"
            value={urlInput}
            onChange={e => onUrlChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  onCreate(urlInput.trim() || undefined);
              if (e.key === 'Escape') { onShowNewBar(false); onUrlChange(''); setShowNewConfig(false); }
            }}
            placeholder="Start URL (blank = empty page)"
            autoComplete="off"
            spellCheck={false}
          />
          <label className={styles['new-bar-proxy']} title="Route through global proxy">
            <input
              type="checkbox"
              checked={useProxy}
              onChange={e => onUseProxyChange(e.target.checked)}
            />
            Proxy
          </label>
          <button
            type="button"
            className={`${styles['cfg-btn']}${showNewConfig ? ` ${styles['cfg-btn--active']}` : ''}`}
            onClick={() => setShowNewConfig(v => !v)}
            title="Configure browser options before launching"
          >
            ⚙️
          </button>
          <button
            type="button"
            className={styles['new-bar-confirm']}
            onClick={() => onCreate(urlInput.trim() || undefined)}
            disabled={creating}
          >
            Open
          </button>
          <button
            type="button"
            className={styles['new-bar-cancel']}
            onClick={() => { onShowNewBar(false); onUrlChange(''); setShowNewConfig(false); }}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles['add-tab-btn']}
          onClick={() => onShowNewBar(true)}
          title="New browser session"
          disabled={creating}
        >
          +
        </button>
      )}
      </div>
      {showNewBar && showNewConfig && (
        <BrowserConfigPanel
          config={newSessionConfig}
          applying={false}
          onApply={(cfg) => { onNewSessionConfigChange(cfg); setShowNewConfig(false); }}
          onClose={() => setShowNewConfig(false)}
        />
      )}
    </div>
  );
}
