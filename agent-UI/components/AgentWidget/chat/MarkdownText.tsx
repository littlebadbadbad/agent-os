/**
 * MarkdownText — chat message renderer powered by react-markdown + remark-gfm.
 *
 * Supports the full GFM spec (tables, task lists, strikethrough, autolinks,
 * nested lists, inline markup in headings, etc.) via `markdownComponents`,
 * and wires search highlighting through context so matches anywhere in the
 * message render as navigable <mark> elements.
 */

import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HighlightProvider, markdownComponents } from './MarkdownComponents';
import styles from '../AgentWidget.module.scss';

const remarkPlugins = [remarkGfm];

interface MarkdownTextProps {
  readonly text: string;
  /** When true, a blinking cursor is appended (streaming in progress). */
  readonly isStreaming?: boolean;
  /** Non-empty query enables search highlighting inside the rendered text. */
  readonly query?: string;
  /** Prefix used to build data-match-key attributes (usually the message id). */
  readonly matchPrefix?: string;
  /** Key of the match to emphasise: `${matchPrefix}:${matchIndex}`. */
  readonly currentMatchKey?: string | null;
}

export function MarkdownText({
  text,
  isStreaming,
  query = '',
  matchPrefix,
  currentMatchKey,
}: MarkdownTextProps): ReactElement {
  // The counter numbers matches across every text node of this message in
  // document order, keeping data-match-key values aligned with a plain-text
  // scan of the same content (see chat/search.ts). Fresh per render pass.
  return (
    <span className={styles['md-root']}>
      <HighlightProvider value={{ query, matchPrefix, currentMatchKey, counter: { value: 0 } }}>
        <ReactMarkdown components={markdownComponents} remarkPlugins={remarkPlugins}>
          {text}
        </ReactMarkdown>
      </HighlightProvider>
      {isStreaming && <span className={styles['cursor']} aria-hidden="true" />}
    </span>
  );
}


