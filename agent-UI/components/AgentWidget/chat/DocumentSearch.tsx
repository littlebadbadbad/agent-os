import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import styles from '../AgentWidget.module.scss';

interface DocumentSearchProps {
  readonly open: boolean;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** 0-based index of the current match, or -1 when there are no matches. */
  readonly matchIndex: number;
  readonly matchCount: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}

const MAGNIFIER_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

/** Floating search bar for the conversation document (VS Code-style). */
export function DocumentSearch({
  open,
  query,
  onQueryChange,
  matchIndex,
  matchCount,
  onPrev,
  onNext,
  onClose,
  onOpen,
}: DocumentSearchProps): ReactElement {
  if (!open) {
    return (
      <button
        type="button"
        className={styles['doc-search-toggle']}
        onClick={onOpen}
        title="Search in conversation (Ctrl+F)"
        aria-label="Search in conversation"
      >
        {MAGNIFIER_ICON}
      </button>
    );
  }

  const hasQuery = query.trim().length > 0;

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className={styles['doc-search']} role="search">
      <span className={styles['doc-search-icon']}>{MAGNIFIER_ICON}</span>
      <input
        className={styles['doc-search-input']}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in conversation"
        autoFocus
        spellCheck={false}
        aria-label="Search in conversation"
      />
      <span className={styles['doc-search-count']}>
        {hasQuery ? `${matchIndex + 1}/${matchCount}` : ''}
      </span>
      <button
        type="button"
        className={styles['doc-search-nav']}
        onClick={onPrev}
        disabled={!hasQuery || matchCount === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        className={styles['doc-search-nav']}
        onClick={onNext}
        disabled={!hasQuery || matchCount === 0}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        className={styles['doc-search-close']}
        onClick={onClose}
        title="Close search (Esc)"
        aria-label="Close search"
      >
        ✕
      </button>
    </div>
  );
}
