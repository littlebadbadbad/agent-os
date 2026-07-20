/**
 * navigator/SessionPanel.tsx — Full-page chat panel view.
 *
 * Shows a back button + session title at the top, then the panel content
 * (ChatMessages + slots) rendered by the caller.
 * ChatInput lives in ConversationNavigator, not here.
 */

import type { ReactElement, ReactNode } from 'react';
import { displayTitle } from './types';
import styles from './styles.module.scss';

interface SessionPanelProps {
  readonly title: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
}

export function SessionPanel({ title, onBack, children }: SessionPanelProps): ReactElement {
  return (
    <div className={styles['panel']}>
      <div className={styles['panel-nav']}>
        <button type="button" className={styles['panel-back-btn']} onClick={onBack} aria-label="Back to session list">←</button>
        <span className={styles['panel-title']}>{displayTitle(title)}</span>
      </div>
      <div className={styles['panel-content']}>{children}</div>
    </div>
  );
}
