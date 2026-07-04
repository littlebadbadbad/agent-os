import { useState, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import styles from '../AgentWidget.module.scss';

export function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming: boolean }): ReactElement {
  // Default to expanded so users see the thinking process immediately.
  const [expanded, setExpanded] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the thinking body to the latest content while streaming.
  useEffect(() => {
    if (isStreaming && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, isStreaming, expanded]);

  return (
    <div className={styles['thinking-block']}>
      <button
        className={styles['thinking-toggle']}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`${styles['thinking-arrow']} ${expanded ? styles['thinking-arrow--open'] : ''}`}>▶</span>
        <span className={styles['thinking-title']}>
          {isStreaming ? '思考中…' : '思考过程'}
        </span>
        {isStreaming && (
          <span className={styles['thinking-dots']} aria-hidden="true">
            <span /><span /><span />
          </span>
        )}
      </button>
      {expanded && (
        <div className={styles['thinking-body']} ref={bodyRef}>
          {text}
          {isStreaming && <span className={styles['cursor']} aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
