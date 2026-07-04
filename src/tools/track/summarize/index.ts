import type { AgentMessage, AgentStreamChunk, HandlerContext } from '@agent-type';
import type { AgentHandler } from '@agent-type';
import {
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_INCREMENTAL_SUMMARY_PROMPT,
  SUMMARY_ANCHOR_PREFIX,
  SUMMARY_ANCHOR_ACK,
} from './constants';
import { yieldToFrame, estimateTokens, messagesToText } from './text';
import { safeSplitIndex, extractSummaryAnchor } from './splitter';

export { estimateTokens } from './text';
export { SUMMARY_ANCHOR_PREFIX, SUMMARY_ANCHOR_ACK } from './constants';

export type SummarizeConfig = {
  /**
   * Handler used to generate the summary.
   * Typically the same handler that drives the main conversation.
   */
  handler: AgentHandler;
  /** System prompt for a first-time full summarization. */
  summaryPrompt?: string;
  /** System prompt for incremental / rolling summarization. */
  incrementalSummaryPrompt?: string;
  /**
   * Number of most-recent messages to keep verbatim.
   * The split point is adjusted to never break a tool-call / tool-result pair.
   * Defaults to `4`.
   */
  keepRecentMessages?: number;
  /**
   * Signal to abort the summarization request.
   * Should be the same signal used for the active agent turn.
   */
  signal: AbortSignal;
  /**
   * Minimum estimated token savings required to proceed with the LLM call.
   * If the pre-call estimate of `oldTokens - anchorTokens` is below this
   * threshold the function returns early without invoking the handler.
   * Defaults to `200`. Set to `0` to always attempt summarization.
   */
  minSavedTokens?: number;
  /**
   * When `true` (default), the function verifies that the produced summary is
   * actually shorter than the original transcript it replaces.  If the model
   * returns a summary that is as long as or longer than the source material,
   * the function returns `savedTokens: 0` without replacing history.
   */
  compressionCheck?: boolean;
};

/**
 * Invoke the handler for a single summarization request and return the
 * produced text (and optional thinking content for reasoning models).
 */
async function callSummarizationHandler(
  handler: AgentHandler,
  request: AgentMessage[],
  signal: AbortSignal,
): Promise<{ text: string; thinking: string | undefined }> {
  const context: HandlerContext = {
    tools: [],
    callTool: () => { throw new Error('callTool: no tools during summarization'); },
    toolChoice: 'none',
    systemPrompt: undefined,
    signal,
  };
  const result = await handler(request, context);

  if ('getReader' in result) {
    const reader = (result as ReadableStream<AgentStreamChunk>).getReader();
    const chunks: string[] = [];
    const thinkingChunks: string[] = [];
    const onAbort = (): void => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'text') chunks.push(value.delta);
        else if (value.type === 'thinking') thinkingChunks.push(value.delta);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      text: chunks.join(''),
      thinking: thinkingChunks.length > 0 ? thinkingChunks.join('') : undefined,
    };
  }

  if ('text' in result) {
    const r = result as { text: string; thinking?: string };
    return { text: r.text, thinking: r.thinking };
  }

  return { text: String(result), thinking: undefined };
}

/**
 * Summarize the older portion of a conversation history.
 *
 * Detects and merges any existing summary anchor (incremental mode), finds a
 * structurally safe split point, invokes the handler with tools disabled, and
 * replaces the old messages with a `[Context summary]` / `Understood.` pair.
 *
 * @returns `{ messages, savedTokens }` — compacted history and estimated tokens freed.
 */
export async function summarizeHistory(
  history: readonly AgentMessage[],
  config: SummarizeConfig,
): Promise<{ messages: AgentMessage[]; savedTokens: number }> {
  const noOp = { messages: [...history], savedTokens: 0 };

  if (config.signal.aborted) return noOp;

  const keepRecent = config.keepRecentMessages ?? 4;
  const minSaved = config.minSavedTokens ?? 200;
  const compressionCheck = config.compressionCheck ?? true;

  const anchor = extractSummaryAnchor(history);
  const effectiveHistory = anchor ? anchor.tail : history;

  if (effectiveHistory.length <= keepRecent + 1) return noOp;

  const desiredSplit = effectiveHistory.length - keepRecent;
  const splitIdx = safeSplitIndex(effectiveHistory, desiredSplit);

  if (splitIdx <= 0 || splitIdx >= effectiveHistory.length) return noOp;

  const oldMessages = effectiveHistory.slice(0, splitIdx);
  const recentMessages = effectiveHistory.slice(splitIdx);

  await yieldToFrame();
  const oldTranscript = messagesToText(oldMessages);
  const oldTokens = estimateTokens(oldTranscript);

  // Pre-flight estimate: bail if the expected saving is too small to justify a
  // full LLM call, regardless of anchor overhead.
  if (minSaved > 0 && oldTokens < minSaved) return noOp;

  let requestContent: string;
  if (anchor) {
    const incrementalPrompt =
      config.incrementalSummaryPrompt ?? DEFAULT_INCREMENTAL_SUMMARY_PROMPT;
    requestContent =
      `${incrementalPrompt}\n\n` +
      `---\n[Existing summary]\n${anchor.previousSummary}\n\n` +
      `[New conversation turns]\n${oldTranscript}`;
  } else {
    const summaryPrompt = config.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;
    requestContent = `${summaryPrompt}\n\n---\n${oldTranscript}`;
  }

  let summaryText: string;
  let summaryThinking: string | undefined;
  try {
    const summarizationRequest: AgentMessage[] = [
      { role: 'user', content: requestContent },
    ];
    const response = await callSummarizationHandler(config.handler, summarizationRequest, config.signal);
    summaryText = response.text.trim();
    summaryThinking = response.thinking;
    if (!summaryText) throw new Error('Empty summary returned');
  } catch {
    return noOp;
  }

  // Compression quality check: the summary must actually be shorter than what
  // it replaces.  A verbose model can return a summary longer than the source
  // which would increase context pressure rather than reduce it.
  if (compressionCheck && estimateTokens(summaryText) >= oldTokens) {
    return noOp;
  }

  await yieldToFrame();
  const anchorPrefix = anchor
    ? `${SUMMARY_ANCHOR_PREFIX}${anchor.previousSummary}\n${SUMMARY_ANCHOR_ACK}\n`
    : '';
  const anchorUserContent = `${SUMMARY_ANCHOR_PREFIX}${summaryText}`;
  const anchorTokens =
    estimateTokens(anchorUserContent) + estimateTokens(SUMMARY_ANCHOR_ACK);
  const priorAnchorTokens = estimateTokens(anchorPrefix);
  const savedTokens = Math.max(0, oldTokens + priorAnchorTokens - anchorTokens);

  // Final savings gate: ensure the net saving meets the minimum threshold.
  if (savedTokens < minSaved) return noOp;

  const compacted: AgentMessage[] = [
    { role: 'user', content: anchorUserContent },
    // Attach the thinking produced during summarization so that thinking-mode
    // models (DeepSeek, Doubao, etc.) receive the required reasoning_content
    // echo for this synthetic assistant turn on subsequent API calls.
    {
      role: 'assistant',
      content: SUMMARY_ANCHOR_ACK,
      ...(summaryThinking != null ? { thinking: summaryThinking } : {}),
    },
    ...recentMessages,
  ];

  return { messages: compacted, savedTokens };
}
