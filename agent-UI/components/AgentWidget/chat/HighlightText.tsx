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
  /**
   * Shared match counter for multi-node texts (e.g. a whole markdown message):
   * each match consumes the next index so keys stay aligned with a plain-text
   * scan of the same content. When omitted, matches are numbered locally.
   */
  readonly counter?: { value: number };
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
  counter,
}: HighlightTextProps): ReactElement {
  const ranges = findMatches(text, query);
  if (ranges.length === 0) return <Fragment>{text}</Fragment>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start > cursor) {
      parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, range.start)}</Fragment>);
    }
    const matchIndex = counter ? counter.value++ : i;
    const key = matchPrefix ? `${matchPrefix}:${matchIndex}` : undefined;
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
