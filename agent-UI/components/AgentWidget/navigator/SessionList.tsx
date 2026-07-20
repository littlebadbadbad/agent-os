/**
 * navigator/SessionList.tsx — List of sessions/conversations.
 *
 * Shows each item's title + time-ago subtitle. Clicking an item navigates
 * to the panel view. Items can be renamed (double-click) or deleted.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactElement, ReactNode, MouseEvent, KeyboardEvent } from 'react';
import type { ConversationItem } from './types';
import { displayTitle } from './types';
import styles from './styles.module.scss';

interface SessionListProps {
  readonly items: readonly ConversationItem[];
  readonly activeId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onRename: (id: string, title: string) => void;
  readonly emptyState: ReactNode;
}

/** Sorted: most recent (last interacted) first. */
function sortBySubtitle(items: readonly ConversationItem[]): ConversationItem[] {
  return [...items].sort((a, b) => {
    // "Just now" sorts first
    const aVal = a.subtitle === 'Just now' ? 0 : 1;
    const bVal = b.subtitle === 'Just now' ? 0 : 1;
    return aVal - bVal;
  });
}

export function SessionList({
  items,
  activeId,
  onSelect,
  onDelete,
  onRename,
  emptyState,
}: SessionListProps): ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEditing = useCallback(
    (e: MouseEvent, item: ConversationItem) => {
      e.stopPropagation();
      setEditingId(item.id);
      setDraft(item.title);
    },
    [],
  );

  const saveEdit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && editingId) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }, [draft, editingId, onRename]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
    },
    [saveEdit],
  );

  if (items.length === 0) {
    return <div className={styles['list-empty']}>{emptyState}</div>;
  }

  const sorted = sortBySubtitle(items);

  return (
    <div className={styles['list']} role="listbox" aria-label="Session list">
      {sorted.map((item) => (
        <div
          key={item.id}
          className={`${styles['list-item']}${item.id === activeId ? ` ${styles['list-item--active']}` : ''}`}
          onClick={() => onSelect(item.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.id); } }}
          role="option"
          aria-selected={item.id === activeId}
          tabIndex={0}
        >
          {editingId === item.id ? (
            <input
              ref={inputRef}
              className={styles['list-item-input']}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div className={styles['list-item-body']}>
                <span className={styles['list-item-title-row']}>
                  {item.isLoading && <span className={styles['list-item-spinner']} />}
                  <span
                    className={styles['list-item-title']}
                    onDoubleClick={(e) => startEditing(e, item)}
                    title="Double-click to rename"
                  >
                    {displayTitle(item.title)}
                  </span>
                </span>
                <span className={styles['list-item-subtitle']}>{item.subtitle}</span>
              </div>
              <button
                type="button"
                className={styles['list-item-delete']}
                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                aria-label={`Delete ${displayTitle(item.title)}`}
                tabIndex={-1}
              >
                ×
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
