/**
 * MarkdownText — chat message renderer powered by react-markdown + remark-gfm.
 *
 * Copy from agent-UI/components/AgentWidget/chat/MarkdownText.tsx
 * for use in the plan app's sandboxed iframe UI.
 */

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './styles.module.scss';

// ── Component map — every HTML element → scoped CSS class ─────────────────────

const components: Components = {
  p:          ({ children }) => <p         className={styles['md-p']}>{children}</p>,
  h1:         ({ children }) => <h1        className={styles['md-h1']}>{children}</h1>,
  h2:         ({ children }) => <h2        className={styles['md-h2']}>{children}</h2>,
  h3:         ({ children }) => <h3        className={styles['md-h3']}>{children}</h3>,
  h4:         ({ children }) => <h4        className={styles['md-h3']}>{children}</h4>,
  h5:         ({ children }) => <h5        className={styles['md-h3']}>{children}</h5>,
  h6:         ({ children }) => <h6        className={styles['md-h3']}>{children}</h6>,
  blockquote: ({ children }) => <blockquote className={styles['md-blockquote']}>{children}</blockquote>,
  ul:         ({ children }) => <ul        className={styles['md-ul']}>{children}</ul>,
  ol:         ({ children }) => <ol        className={styles['md-ol']}>{children}</ol>,
  li:         ({ children }) => <li        className={styles['md-li']}>{children}</li>,
  hr:         ()             => <hr        className={styles['md-hr']} />,
  img:        ({ src, alt }) => <img       className={styles['md-img']} src={src} alt={alt ?? ''} loading="lazy" />,
  a:          ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  pre:        ({ children }) => <pre className={styles['md-pre']}>{children}</pre>,
  code:       ({ className, children }) => {
    const isBlock = /\blanguage-/.test(className ?? '');
    return isBlock
      ? <code className={className}>{children}</code>
      : <code className={styles['md-code']}>{children}</code>;
  },
  table: ({ children }) => (
    <div className={styles['md-table-wrap']}>
      <table className={styles['md-table']}>{children}</table>
    </div>
  ),
  thead:  ({ children }) => <thead className={styles['md-thead']}>{children}</thead>,
  tbody:  ({ children }) => <tbody className={styles['md-tbody']}>{children}</tbody>,
  tr:     ({ children }) => <tr    className={styles['md-tr']}>{children}</tr>,
  th:     ({ children }) => <th    className={styles['md-th']}>{children}</th>,
  td:     ({ children }) => <td    className={styles['md-td']}>{children}</td>,
  input:  ({ type, checked, disabled: _disabled, ...rest }) =>
    type === 'checkbox'
      ? <input className={styles['md-task-checkbox']} type="checkbox" checked={checked} readOnly {...rest} />
      : <input type={type} {...rest} />,
};

const REMARK_APPS = [remarkGfm];

// ── Public component ──────────────────────────────────────────────────────────

interface MarkdownTextProps {
  text: string;
  isStreaming?: boolean;
}

export function MarkdownText({ text, isStreaming }: MarkdownTextProps) {
  return (
    <span className={styles['md-root']}>
      <ReactMarkdown components={components} remarkApps={REMARK_APPS}>
        {text}
      </ReactMarkdown>
      {isStreaming && <span className={styles['cursor']} aria-hidden="true" />}
    </span>
  );
}
