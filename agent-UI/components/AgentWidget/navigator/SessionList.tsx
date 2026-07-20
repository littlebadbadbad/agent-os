/**
 * navigator/SessionList.tsx — List of sessions/conversations.
 *
 * Shows three rows per item (if available):
 *   1. Title + loading spinner
 *   2. Subtitle (user-editable, hidden when empty)
 *   3. Time-ago (computed from updatedAt, hidden when empty)
 *
 * Double-clicking an item enters edit mode with inline title+subtitle inputs.
 * Items are sorted by `updatedAt` (most recent first).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactElement, ReactNode, MouseEvent, KeyboardEvent, ChangeEvent, FocusEvent } from 'react';
import type { ConversationItem } from './types';
import { displayTitle } from './types';
import { formatTimeAgo } from './timeAgo';
import styles from './styles.module.scss';

interface SessionListProps {
  readonly items: readonly ConversationItem[];
  readonly activeId: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onRename: (id: string, title: string, subtitle: string) => void;
  readonly emptyState: ReactNode;
}

/** Sorted: most recent (largest updatedAt) first. */
function sortByUpdatedAt(items: readonly ConversationItem[]): ConversationItem[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

interface EditDraft {
  readonly title: string;
  readonly subtitle: string;
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
  const [draft, setDraft] = useState<EditDraft>({ title: '', subtitle: '' });
  const titleRef = useRef<HTMLInputElement>(null);
  const editWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingId && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingId]);

  const startEditing = useCallback(
    (e: MouseEvent, item: ConversationItem) => {
      e.stopPropagation();
      setEditingId(item.id);
      setDraft({ title: item.title, subtitle: item.subtitle });
    },
    [],
  );

  const saveEdit = useCallback(() => {
    const { title, subtitle } = draft;
    if (title.trim() && editingId) {
      onRename(editingId, title.trim(), subtitle.trim());
    }
    setEditingId(null);
  }, [draft, editingId, onRename]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  /**
   * Save only when focus truly leaves the entire edit wrap (not just
   * tabbing between the two inputs inside it).
   */
  const handleEditBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      // If the newly focused element is still inside the edit wrap, ignore.
      if (editWrapRef.current?.contains(e.relatedTarget as Node)) return;
      saveEdit();
    },
    [saveEdit],
  );

  const handleTitleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setDraft((prev) => ({ ...prev, title: e.target.value }));
    },
    [],
  );

  const handleSubtitleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setDraft((prev) => ({ ...prev, subtitle: e.target.value }));
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    },
    [saveEdit, cancelEdit],
  );

  if (items.length === 0) {
    return <div className={styles['list-empty']}>{emptyState}</div>;
  }

  const sorted = sortByUpdatedAt(items);
  const timeAgoLabel = formatTimeAgo;

  return (
    <div className={styles['list']} role="listbox" aria-label="Session list">
      {sorted.map((item) => {
        const timeText = timeAgoLabel(item.updatedAt);

        return (
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
              <div
                ref={editWrapRef}
                className={styles['list-item-edit-wrap']}
                onBlur={handleEditBlur}
              >
                <input
                  ref={titleRef}
                  className={styles['list-item-input']}
                  value={draft.title}
                  onChange={handleTitleChange}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Title"
                />
                <input
                  className={styles['list-item-input']}
                  value={draft.subtitle}
                  onChange={handleSubtitleChange}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Subtitle (optional)"
                />
              </div>
            ) : (
              <>
                <div className={styles['list-item-body']}>
                  <span
                    className={styles['list-item-title-row']}
                    onDoubleClick={(e) => startEditing(e, item)}
                    title="Double-click to rename"
                  >
                    {item.isLoading && <span className={styles['list-item-spinner']} />}
                    <span className={styles['list-item-title']}>
                      {displayTitle(item.title)}
                    </span>
                  </span>
                  {item.subtitle ? (
                    <span
                      className={styles['list-item-subtitle']}
                      onDoubleClick={(e) => startEditing(e, item)}
                    >
                      {item.subtitle}
                    </span>
                  ) : null}
                  {timeText ? (
                    <span className={styles['list-item-time']}>{timeText}</span>
                  ) : null}
                </div>
                <div className={styles['list-item-actions']}>
                  <button
                    type="button"
                    className={styles['list-item-edit']}
                    onClick={(e) => { e.stopPropagation(); startEditing(e, item); }}
                    aria-label={`Edit ${displayTitle(item.title)}`}
                    tabIndex={-1}
                  >
                    ✏
                  </button>
                  <button
                    type="button"
                    className={styles['list-item-delete']}
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    aria-label={`Delete ${displayTitle(item.title)}`}
                    tabIndex={-1}
                  >
                    ×
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
