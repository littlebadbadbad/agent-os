import type { ReactElement } from 'react';
import type { BrowserTabInfo } from '../agent/index';
import styles from './BrowserPanel.module.scss';

// ── BrowserPageTabs ───────────────────────────────────────────────────────────
// Renders the inner tab strip for pages (tabs) within a single browser session.
// Intentionally separate from BrowserTabBar, which manages browser *sessions*.

export interface BrowserPageTabsProps {
  /** All tabs currently open in this session. */
  tabs: BrowserTabInfo[];
  /** Index of the currently active tab. */
  activeIndex: number;
  /** Called when the user clicks a tab to switch to it. */
  onSwitch(index: number): void;
  /** Disable all tab buttons (e.g. while session is not alive). */
  disabled?: boolean;
}

/**
 * Tab strip for pages inside a single browser session.
 * Renders nothing when there is only one tab open (no clutter for the common case).
 */
export function BrowserPageTabs({
  tabs,
  activeIndex,
  onSwitch,
  disabled = false,
}: BrowserPageTabsProps): ReactElement | null {
  if (tabs.length <= 1) return null;

  return (
    <div className={styles['page-tabs']} role="tablist" aria-label="Browser tabs">
      {tabs.map((tab) => {
        const isActive = tab.index === activeIndex;
        const label    = tab.title || tab.url || '(new tab)';
        return (
          <button
            key={tab.index}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles['page-tab']}${isActive ? ` ${styles['page-tab--active']}` : ''}`}
            onClick={() => onSwitch(tab.index)}
            disabled={disabled || isActive}
            title={tab.url ?? '(blank)'}
          >
            <span className={styles['page-tab-label']}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
