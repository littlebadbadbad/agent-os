import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement, ReactNode } from 'react';
import styles from '../AgentWidget.module.scss';

interface ToolCardModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Full-detail overlay for a tool call.
 * Rendered via a portal on document.body so it isn't clipped by any overflow
 * container. Closes on Escape or backdrop click.
 */
export function ToolCardModal({ title, onClose, children }: ToolCardModalProps): ReactElement {
  // Keyboard handler: Escape closes the modal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className={styles['tc-modal-backdrop']}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles['tc-modal-panel']}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles['tc-modal-header']}>
          <span className={styles['tc-modal-title']}>{title}</span>
          <button
            type="button"
            className={styles['tc-modal-close']}
            onClick={onClose}
            aria-label="Close detail view"
          >
            ✕
          </button>
        </div>
        <div className={styles['tc-modal-body']}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
