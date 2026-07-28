/**
 * extensions/browser/ui/BrowserAddressBar.tsx
 *
 * Address / navigation bar for a single browser session.
 * Extracted from BrowserSessionView for modularity.
 */

import { useState, useRef, useCallback, type ReactElement } from 'react';
import styles from './BrowserPanel.module.scss';

export interface BrowserAddressBarProps {
  /** Current page URL. */
  url: string;
  /** Current page title, or null. */
  pageTitle: string | null;
  /** Whether the browser session is alive. */
  alive: boolean;
  /** Whether proxy is enabled for this session. */
  useProxy: boolean;
  /** Whether a navigation is in progress. */
  navigating: boolean;
  /** Called when user navigates to a URL. */
  onNavigate(url: string): void;
  /** Called when user clicks the proxy toggle button. */
  onToggleProxy(): void;
  /** Called when user opens the config panel. */
  onToggleConfig(): void;
  /** Called when user opens the video settings panel. */
  onToggleVideoSettings(): void;
}

/**
 * Address bar with navigation input, page title, proxy toggle, config/video buttons.
 */
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

  // Sync external url changes into the input (unless user is editing).
  if (url !== addrInput && !addrFocusedRef.current) {
    // Only sync when address bar is not focused — avoid stealing user input.
  }

  const handleNavigate = useCallback(() => {
    const trimmed = addrInput.trim();
    if (!trimmed || navigating) return;
    let finalUrl = trimmed;
    if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }
    onNavigate(finalUrl);
  }, [addrInput, navigating, onNavigate]);

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
