/**
 * chat/search.ts — pure, framework-free search helpers for the conversation.
 *
 * Kept framework-free so the logic is unit-testable and shared by the search
 * bar (DocumentSearch) and the highlight renderers (HighlightText).
 */

import type { Message } from '../types';

export interface MatchRange {
  readonly start: number;
  readonly end: number;
}

/** Flat, ordered list of every match across the conversation. */
export interface SearchMatch {
  readonly messageId: string;
  readonly matchIndex: number;
}

/** Case-insensitive, non-overlapping occurrence scan of `query` in `text`. */
export function findMatches(text: string, query: string): readonly MatchRange[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const hay = text.toLowerCase();
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const index = hay.indexOf(needle, from);
    if (index === -1) break;
    ranges.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }
  return ranges;
}

/** Aggregates per-message matches into one navigable flat list. */
export function collectMatches(
  messages: readonly Message[],
  query: string,
): readonly SearchMatch[] {
  if (query.trim().length === 0) return [];

  const matches: SearchMatch[] = [];
  for (const message of messages) {
    const count = findMatches(message.content, query).length;
    for (let i = 0; i < count; i += 1) {
      matches.push({ messageId: message.id, matchIndex: i });
    }
  }
  return matches;
}
