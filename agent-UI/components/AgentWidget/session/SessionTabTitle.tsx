import { useState, useRef, useCallback, useEffect } from 'react';
import type { ReactElement } from 'react';
import type { SessionManager } from '@agent-sdk';
import styles from '../AgentWidget.module.scss';

export function SessionTabTitle({
  sessionId,
  title,
  sessionManager,
}: {
  sessionId: string;
  title: string;
  sessionManager: SessionManager;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(title);
    setEditing(true);
  }, [title]);

  const save = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      sessionManager.renameSession(sessionId, trimmed);
    }
    setEditing(false);
  }, [draft, title, sessionId, sessionManager]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }, [save, cancel]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles['session-tab-title-input']}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={styles['session-tab-title']}
      onDoubleClick={startEditing}
      title="Double-click to rename"
    >
      <span className={styles['session-tab-title-text']}>{title}</span>
      <span className={styles['session-tab-edit-icon']}>✎</span>
    </span>
  );
}
