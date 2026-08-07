import type { ReactElement } from 'react';
import type { Message } from '../types';
import { HighlightText } from './HighlightText';
import { AttachmentList } from './AttachmentList';
import styles from '../AgentWidget.module.scss';

interface UserNoteProps {
  readonly message: Message;
  /** Non-empty query enables in-text highlighting. */
  readonly query: string;
  readonly currentMatchKey?: string | null;
  readonly onEdit: () => void;
}

/**
 * The "1% inspiration" — a user prompt rendered as a chapter-opening note.
 * Prominent but compact: it reads as the spark that lights the body of work
 * below it, never as a chat bubble.
 */
export function UserNote({
  message,
  query,
  currentMatchKey,
  onEdit,
}: UserNoteProps): ReactElement {
  return (
    <div className={styles['user-note']}>
      <span className={styles['user-note-marker']} aria-hidden="true">✦</span>
      <div className={styles['user-note-body']}>
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentList attachments={message.attachments} />
        )}
        <HighlightText
          text={message.content}
          query={query}
          matchPrefix={message.id}
          currentMatchKey={currentMatchKey}
        />
      </div>
      <button
        type="button"
        className={styles['user-note-edit']}
        onClick={onEdit}
        title="Edit this message"
        aria-label="Edit this message"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
    </div>
  );
}
