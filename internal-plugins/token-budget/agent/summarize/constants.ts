export const DEFAULT_SUMMARY_PROMPT =
  `You are a conversation summarizer. ` +
  `Condense the conversation below into a concise summary that faithfully preserves ` +
  `all key facts, user goals, decisions made, tool calls and their results, ` +
  `and any context needed to continue the task seamlessly. ` +
  `Write in third person ("The user asked…", "The assistant found…"). ` +
  `Output ONLY the summary — no preamble, no headings, no bullet formatting.`;

export const DEFAULT_INCREMENTAL_SUMMARY_PROMPT =
  `You are a conversation summarizer. ` +
  `Below is an existing running summary of a conversation, followed by new conversation turns. ` +
  `Produce an updated summary that merges all key facts, user goals, decisions made, ` +
  `tool calls and their results, and any context needed to continue the task seamlessly. ` +
  `Write in third person ("The user asked…", "The assistant found…"). ` +
  `Output ONLY the updated summary — no preamble, no headings, no bullet formatting.`;

/** Prefix that identifies a summary anchor message in the conversation history. */
export const SUMMARY_ANCHOR_PREFIX = '[Context summary]\n';

/** The fixed acknowledgement message that follows every summary anchor. */
export const SUMMARY_ANCHOR_ACK = 'Understood.';

/**
 * Maximum characters to include from a single tool-result when building the
 * summarization transcript.
 */
export const MAX_TOOL_RESULT_CHARS = 8_000;
