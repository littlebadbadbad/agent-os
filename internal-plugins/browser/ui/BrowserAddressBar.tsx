/**
 * BrowserAddressBar — navigation bar for a single browser session.
 */

import { useState, useRef, useCallback, useEffect, type ReactElement } from 'react';
import styles from './BrowserPanel.module.scss';

export interface BrowserAddressBarProps {
  url: string;
  pageTitle: string | null;
  alive: boolean;
  useProxy: boolean;
  navigating: boolean;
  onNavigate(url: string): void;
  onToggleProxy(): void;
  onToggleConfig(): void;
  onToggleVideoSettings(): void;
}

export function BrowserAddressBar({
  url,
  pageTitle,
  alive,
  useProxy,
  navigating,
  onNavigate,
  onToggleProxy,
  onToggleConfig,
  onToggleVideoSettings,
}: BrowserAddressBarProps): ReactElement {
  const [addrInput, setAddrInput] = useState(url);
  const addrFocusedRef = useRef(false);
  const addrInputRef = useRef(addrInput);
  addrInputRef.current = addrInput;

  // Sync external URL changes into the input, but only when the user is not editing.
  useEffect(() => {
    if (!addrFocusedRef.current && url !== addrInput) {
      setAddrInput(url);
    }
    // addrInput intentionally omitted — only react to external url changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleNavigate = useCallback(() => {
    const trimmed = addrInputRef.current.trim();
    if (!trimmed || navigating) return;
    const finalUrl = /^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    onNavigate(finalUrl);
  }, [navigating, onNavigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleNavigate();
    },
    [handleNavigate],
  );

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
    addrFocusedRef.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    addrFocusedRef.current = false;
  }, []);

  return (
    <div className={styles['addr-bar']}>
      <button
        type="button"
        className={styles['addr-go-btn']}
        onClick={handleNavigate}
        disabled={!alive || navigating}
        title="Navigate"
      >
        {navigating ? '\u2026' : '\u25B6'}
      </button>
      <input
        className={styles['addr-input']}
        type="text"
        value={addrInput}
        onChange={(e) => setAddrInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="https://example.com"
        disabled={!alive || navigating}
        autoComplete="off"
        spellCheck={false}
      />
      {pageTitle && (
        <span className={styles['info-title']} title={pageTitle}>
          {pageTitle}
        </span>
      )}
      <button
        type="button"
        className={`${styles['proxy-toggle']}${
          useProxy ? ` ${styles['proxy-toggle--on']}` : ` ${styles['proxy-toggle--off']}`
        }`}
        onClick={onToggleProxy}
        title={useProxy ? 'Proxy ON \u2014 click to disable' : 'Proxy OFF \u2014 click to enable'}
      >
        {useProxy ? 'Proxy \u25CF' : 'Proxy \u25CB'}
      </button>
      <button
        type="button"
        className={styles['cfg-btn']}
        onClick={onToggleConfig}
        title="Browser configuration"
      >
        {'\u2699\uFE0F'}
      </button>
      <button
        type="button"
        className={styles['cfg-btn']}
        onClick={onToggleVideoSettings}
        title="Video settings"
      >
        {'\uD83D\uDDA5'}
      </button>
    </div>
  );
}
