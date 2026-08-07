/**
 * internal-plugins/token-budget/agent/summarize/structured.ts — Structured summary helpers
 *
 * Builds the summarization request content (full vs. incremental) and extracts
 * the final summary from the model's raw output, tolerating models that ignore
 * the `<summary>` tags.
 */

import {
  DEFAULT_INCREMENTAL_SUMMARY_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  SUMMARY_TAG_CLOSE,
  SUMMARY_TAG_OPEN,
} from './constants';

/**
 * Extract the summary text from a model response.
 *
 * Prefers the content inside the outermost `<summary></summary>` tags;
 * falls back to the trimmed raw text when no valid tag pair is present.
 */
export function extractSummaryText(raw: string): string {
  const start = raw.indexOf(SUMMARY_TAG_OPEN);
  const end = raw.lastIndexOf(SUMMARY_TAG_CLOSE);
  if (start >= 0 && end > start) {
    return raw.slice(start + SUMMARY_TAG_OPEN.length, end).trim();
  }
  return raw.trim();
}

/**
 * Build the user-turn content for a summarization request.
 *
 * @param anchor                   Previous summary anchor, or `null` for a first summary.
 * @param transcript               The conversation transcript to summarize.
 * @param summaryPrompt            Optional override for first-time summaries.
 * @param incrementalSummaryPrompt Optional override for incremental summaries.
 */
export function buildSummarizationPrompt(
  anchor: { readonly previousSummary: string } | null,
  transcript: string,
  summaryPrompt?: string,
  incrementalSummaryPrompt?: string,
): string {
  if (anchor) {
    return [
      `${incrementalSummaryPrompt ?? DEFAULT_INCREMENTAL_SUMMARY_PROMPT}\n`,
      '---',
      `[Existing summary]\n${anchor.previousSummary}`,
      `[New conversation turns]\n${transcript}`,
    ].join('\n\n');
  }
  return `${summaryPrompt ?? DEFAULT_SUMMARY_PROMPT}\n\n---\n${transcript}`;
}
