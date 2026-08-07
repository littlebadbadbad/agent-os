import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { findMatches } from './search';
import styles from '../AgentWidget.module.scss';

interface HighlightTextProps {
  /** Plain text to render (may contain matches). */
  readonly text: string;
  /** Non-empty query enables highlighting; an empty query renders plain text. */
  readonly query: string;
  /** Prefix for data-match-key attributes (usually the message id). */
  readonly matchPrefix?: string;
  /** Key of the match to emphasise: `${matchPrefix}:${matchIndex}`. */
  readonly currentMatchKey?: string | null;
}

/**
 * Renders text with every occurrence of `query` wrapped in <mark>.
 * Each mark carries a stable data-match-key so callers can scroll to it.
 */
export function HighlightText({
  text,
  query,
  matchPrefix,
  currentMatchKey,
}: HighlightTextProps): ReactElement {
  const ranges = findMatches(text, query);
  if (ranges.length === 0) return <Fragment>{text}</Fragment>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start > cursor) {
      parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, range.start)}</Fragment>);
    }
    const key = matchPrefix ? `${matchPrefix}:${i}` : undefined;
    const className =
      key !== undefined && key === currentMatchKey
        ? `${styles['mark']} ${styles['mark--current']}`
        : styles['mark'];
    parts.push(
      <mark key={`m${i}`} className={className} data-match-key={key}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  }
  return <Fragment>{parts}</Fragment>;
}
