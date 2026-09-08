/**
 * Element map for the chat markdown renderer.
 *
 * Every HTML node produced by react-markdown is mapped to its scoped `.md-*`
 * CSS-module class. Text containers wrap their string children through the
 * `Highlight` component so search matches render as <mark>; the highlight
 * state (query, match keys, shared counter) comes from context, which
 * MarkdownText provides. Without a provider the text renders unstyled.
 */

import { Children, createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { HighlightText } from './HighlightText';
import styles from '../AgentWidget.module.scss';

export interface MarkdownHighlightState {
  readonly query: string;
  readonly matchPrefix?: string;
  readonly currentMatchKey?: string | null;
  /** Numbers matches across every text node of one message, in document order. */
  readonly counter: { value: number };
}

const highlightContext = createContext<MarkdownHighlightState | null>(null);

export const HighlightProvider = highlightContext.Provider;

/** Highlights every plain-string child; element children render themselves. */
function Highlight({ children }: { children: ReactNode }): ReactElement {
  const state = useContext(highlightContext);
  if (!state || state.query === '') return <>{children}</>;
  return (
    <>
      {Children.map(children, (child) =>
        typeof child === 'string' ? <HighlightText text={child} {...state} /> : child,
      )}
    </>
  );
}

export const markdownComponents: Components = {
  p: ({ children }) => <p className={styles['md-p']}><Highlight>{children}</Highlight></p>,
  h1: ({ children }) => <h1 className={styles['md-h1']}><Highlight>{children}</Highlight></h1>,
  h2: ({ children }) => <h2 className={styles['md-h2']}><Highlight>{children}</Highlight></h2>,
  h3: ({ children }) => <h3 className={styles['md-h3']}><Highlight>{children}</Highlight></h3>,
  h4: ({ children }) => <h4 className={styles['md-h3']}><Highlight>{children}</Highlight></h4>,
  h5: ({ children }) => <h5 className={styles['md-h3']}><Highlight>{children}</Highlight></h5>,
  h6: ({ children }) => <h6 className={styles['md-h3']}><Highlight>{children}</Highlight></h6>,
  blockquote: ({ children }) => (
    <blockquote className={styles['md-blockquote']}><Highlight>{children}</Highlight></blockquote>
  ),
  ul: ({ children }) => <ul className={styles['md-ul']}>{children}</ul>,
  ol: ({ children }) => <ol className={styles['md-ol']}>{children}</ol>,
  li: ({ children }) => <li className={styles['md-li']}><Highlight>{children}</Highlight></li>,
  hr: () => <hr className={styles['md-hr']} />,
  img: ({ src, alt }) => (
    <img className={styles['md-img']} src={src} alt={alt ?? ''} loading="lazy" />
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"><Highlight>{children}</Highlight></a>
  ),
  strong: ({ children }) => <strong><Highlight>{children}</Highlight></strong>,
  em: ({ children }) => <em><Highlight>{children}</Highlight></em>,
  del: ({ children }) => <del><Highlight>{children}</Highlight></del>,
  pre: ({ children }) => <pre className={styles['md-pre']}>{children}</pre>,
  code: ({ className, children }) => {
    const isBlock = className?.split(' ').some((c) => c.startsWith('language-'));
    return isBlock
      ? <code className={className}>{children}</code>
      : <code className={styles['md-code']}><Highlight>{children}</Highlight></code>;
  },
  table: ({ children }) => (
    <div className={styles['md-table-wrap']}>
      <table className={styles['md-table']}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className={styles['md-thead']}>{children}</thead>,
  tbody: ({ children }) => <tbody className={styles['md-tbody']}>{children}</tbody>,
  tr: ({ children }) => <tr className={styles['md-tr']}>{children}</tr>,
  th: ({ children }) => <th className={styles['md-th']}><Highlight>{children}</Highlight></th>,
  td: ({ children }) => <td className={styles['md-td']}><Highlight>{children}</Highlight></td>,
  input: ({ type, checked }) =>
    type === 'checkbox'
      ? (
        <input
          className={styles['md-task-checkbox']}
          type="checkbox"
          checked={checked === true}
          readOnly
        />
      )
      : <input type={type} />,
};
