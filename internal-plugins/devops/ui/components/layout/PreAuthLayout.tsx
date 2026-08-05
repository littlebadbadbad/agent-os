import React from 'react';
import styles from './PreAuthLayout.module.scss';

interface PreAuthLayoutProps {
  children: React.ReactNode;
}

/**
 * Minimal shell shown before the user logs in.
 */
export function PreAuthLayout({ children }: PreAuthLayoutProps) {
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg width="22" height="22" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect width="40" height="40" rx="8" fill="#0078d4" />
            <path d="M8 30L16 10L24 22L30 16L32 30H8Z" fill="white" opacity="0.9" />
          </svg>
          <span>Azure DevOps</span>
        </div>
      </header>

      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}
