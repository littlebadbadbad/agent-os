/**
 * navigator/SessionPanel.tsx — Full-page chat panel view.
 *
 * Shows a back button + session title at the top, then the panel content
 * (ChatMessages + slots) rendered by the caller, and a ChatInput at the
 * bottom (rendered by ConversationNavigator, not here).
 */

import type { ReactElement, ReactNode } from 'react';
import type { ConversationItem } from './types';
import styles from './styles.module.scss';

interface SessionPanelProps {
  readonly item: ConversationItem;
  readonly onBack: () => void;
  /** Renders the main content area (messages + plugin slots). */
  readonly children: ReactNode;
}

export function SessionPanel({ item, onBack, children }: SessionPanelProps): ReactElement {
  return (
    <div className={styles['panel']}>
      {/* Navigation bar */}
      <div className={styles['panel-nav']}>
        <button
          type="button"
          className={styles['panel-back-btn']}
          onClick={onBack}
          aria-label="Back to session list"
        >
          ←
        </button>
        <span className={styles['panel-title']}>{item.title}</span>
      </div>

      {/* Content area — messages, slots, etc. */}
      <div className={styles['panel-content']}>
        {children}
      </div>
    </div>
  );
}
