/**
 * internal-plugins/token-budget/agent/summarize/constants.ts — Summarization prompts & constants
 *
 * The default prompts follow the structured-compaction style used by Claude Code:
 * a sectioned summary (Task Overview / Current State / Important Discoveries /
 * Next Steps / Context to Preserve) wrapped in `<summary></summary>` tags so the
 * output is machine-extractable while remaining readable to the model.
 */

/** Opening tag that marks the start of the final summary. */
export const SUMMARY_TAG_OPEN = '<summary>';

/** Closing tag that marks the end of the final summary. */
export const SUMMARY_TAG_CLOSE = '</summary>';

/** Prompt for a first-time full summarization. */
export const DEFAULT_SUMMARY_PROMPT = [
  'You are compacting a conversation for a continuing session. The history you see will be replaced by your summary, so capture everything needed to resume without loss.',
  'Write a structured summary with these sections:',
  '1. Task Overview — the user\'s core request, success criteria and any constraints',
  '2. Current State — what has been completed, files touched, key outputs or artifacts',
  '3. Important Discoveries — technical constraints, decisions and their rationale, errors and how they were fixed, approaches that did not work',
  '4. Next Steps — specific remaining actions, blockers or open questions, in priority order',
  '5. Context to Preserve — user preferences, domain details that are not obvious, any promises made',
  'Prefer including information that prevents duplicate work. Write in the third person.',
  `Wrap the final summary in ${SUMMARY_TAG_OPEN}${SUMMARY_TAG_CLOSE} tags.`,
].join('\n');

/** Prompt for incremental / rolling summarization (existing summary + new turns). */
export const DEFAULT_INCREMENTAL_SUMMARY_PROMPT = [
  'You are compacting a conversation for a continuing session. Below is an existing running summary followed by new conversation turns.',
  'Produce an updated summary that merges the new turns into the existing one, following the same structure (Task Overview / Current State / Important Discoveries / Next Steps / Context to Preserve).',
  'Keep information that prevents duplicate work; drop details that are now redundant.',
  'Write in the third person.',
  `Wrap the final summary in ${SUMMARY_TAG_OPEN}${SUMMARY_TAG_CLOSE} tags.`,
].join('\n');

/** Prefix that identifies a summary anchor message in the conversation history. */
export const SUMMARY_ANCHOR_PREFIX = '[Context summary]\n';

/** The fixed acknowledgement message that follows every summary anchor. */
export const SUMMARY_ANCHOR_ACK = 'Understood.';

/** Placeholder replacing a cleared tool result during tool-result clearing. */
export const CLEARED_TOOL_RESULT = '[tool result cleared during compaction]';

/**
 * Maximum characters to include from a single tool-result when building the
 * summarization transcript.
 */
export const MAX_TOOL_RESULT_CHARS = 8_000;

/**
 * Default chunk size (estimated tokens) above which the transcript is split
 * into multiple chunks and summarized map-reduce style.
 */
export const DEFAULT_MAX_CHUNK_TOKENS = 16_000;
