import { describe, it, expect } from 'vitest';
import { extractSummaryText, buildSummarizationPrompt } from '../agent/summarize/structured';
import { SUMMARY_TAG_OPEN, SUMMARY_TAG_CLOSE } from '../agent/summarize/constants';

// ── extractSummaryText ────────────────────────────────────────────────────────

describe('extractSummaryText', () => {
  it('extracts content from within summary tags', () => {
    const raw = `Some preamble.\n${SUMMARY_TAG_OPEN}The actual summary.${SUMMARY_TAG_CLOSE}\nTrailing.`;
    expect(extractSummaryText(raw)).toBe('The actual summary.');
  });

  it('trims the extracted content', () => {
    const raw = `${SUMMARY_TAG_OPEN}\n  padded summary  \n${SUMMARY_TAG_CLOSE}`;
    expect(extractSummaryText(raw)).toBe('padded summary');
  });

  it('falls back to the trimmed raw text when no tags are present', () => {
    expect(extractSummaryText('  plain summary  ')).toBe('plain summary');
  });

  it('falls back to the raw text when the closing tag precedes the opening tag', () => {
    const raw = `${SUMMARY_TAG_CLOSE}broken${SUMMARY_TAG_OPEN}`;
    expect(extractSummaryText(raw)).toBe(raw);
  });

  it('returns an empty string for empty input', () => {
    expect(extractSummaryText('')).toBe('');
  });
});

// ── buildSummarizationPrompt ──────────────────────────────────────────────────

describe('buildSummarizationPrompt', () => {
  it('builds a first-time prompt from the default template', () => {
    const prompt = buildSummarizationPrompt(null, 'transcript body');
    expect(prompt).toContain('transcript body');
    expect(prompt).toContain('---');
    expect(prompt).not.toContain('[Existing summary]');
  });

  it('builds an incremental prompt with the previous summary', () => {
    const prompt = buildSummarizationPrompt({ previousSummary: 'old summary' }, 'new turns');
    expect(prompt).toContain('[Existing summary]');
    expect(prompt).toContain('old summary');
    expect(prompt).toContain('new turns');
  });

  it('uses a custom summary prompt override', () => {
    const prompt = buildSummarizationPrompt(null, 't', 'CUSTOM FULL');
    expect(prompt).toContain('CUSTOM FULL');
  });

  it('uses a custom incremental prompt override', () => {
    const prompt = buildSummarizationPrompt({ previousSummary: 'old' }, 't', 'FULL', 'CUSTOM INC');
    expect(prompt).toContain('CUSTOM INC');
    expect(prompt).not.toContain('FULL');
  });
});
