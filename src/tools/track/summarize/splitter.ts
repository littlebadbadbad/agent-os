import type { AgentMessage } from '@agent-type';
import { SUMMARY_ANCHOR_PREFIX, SUMMARY_ANCHOR_ACK } from './constants';

/**
 * Find the earliest safe split index >= `desiredIdx` such that no
 * tool-call / tool-result pair is broken across the boundary.
 */
export function safeSplitIndex(
  history: readonly AgentMessage[],
  desiredIdx: number,
): number {
  let idx = Math.min(desiredIdx, history.length);

  for (let guard = 0; guard < history.length; guard++) {
    // Skip over any tool-result messages stranded at this index.
    while (idx < history.length && history[idx].role === 'tool') idx++;

    // If the message just before idx is an assistant turn with pending tool
    // calls, pull the whole turn into "recent" and retry.
    if (idx > 0 && history[idx - 1].role === 'assistant') {
      const prev = history[idx - 1];
      if ('toolCalls' in prev && prev.toolCalls && prev.toolCalls.length > 0) {
        idx -= 1;
        continue;
      }
    }

    break;
  }

  return idx;
}

/**
 * Detect a previously produced summary anchor pair at the start of history.
 * Returns the prior summary text and the remainder of history, or `null`.
 */
export function extractSummaryAnchor(
  history: readonly AgentMessage[],
): { previousSummary: string; tail: readonly AgentMessage[] } | null {
  if (
    history.length >= 2 &&
    history[0].role === 'user' &&
    typeof history[0].content === 'string' &&
    history[0].content.startsWith(SUMMARY_ANCHOR_PREFIX) &&
    history[1].role === 'assistant' &&
    history[1].content === SUMMARY_ANCHOR_ACK
  ) {
    return {
      previousSummary: history[0].content.slice(SUMMARY_ANCHOR_PREFIX.length),
      tail: history.slice(2),
    };
  }
  return null;
}
