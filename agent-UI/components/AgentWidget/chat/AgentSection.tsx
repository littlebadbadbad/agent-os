import type { ReactElement } from 'react';
import type { Message } from '../types';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownText } from './MarkdownText';
import { AttachmentList } from './AttachmentList';
import styles from '../AgentWidget.module.scss';

interface AgentSectionProps {
  readonly message: Message;
  /** Non-empty query enables search highlighting inside the rendered markdown. */
  readonly query: string;
  readonly currentMatchKey?: string | null;
}

/** One agent reply rendered as a continuous section of the working document. */
export function AgentSection({
  message,
  query,
  currentMatchKey,
}: AgentSectionProps): ReactElement {
  return (
    <div className={styles['agent-section']}>
      {message.thinking && (
        <ThinkingBlock text={message.thinking} isStreaming={!!message.isStreaming} />
      )}
      {message.isStreaming && message.content === '' && !message.thinking ? (
        <span className={styles['thinking']} role="status" aria-label="Thinking">
          <span />
          <span />
          <span />
        </span>
      ) : message.isStreaming && message.content === '' ? null : (
        <MarkdownText
          text={message.content}
          isStreaming={message.isStreaming}
          query={query}
          matchPrefix={message.id}
          currentMatchKey={currentMatchKey}
        />
      )}
      {message.attachments && message.attachments.length > 0 && (
        <AttachmentList attachments={message.attachments} />
      )}
    </div>
  );
}
