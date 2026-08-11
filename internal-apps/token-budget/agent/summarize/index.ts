import type { AgentMessage, AgentHandler, AgentStreamChunk, HandlerContext } from '@agent-type';
import {
  DEFAULT_MAX_CHUNK_TOKENS,
  SUMMARY_ANCHOR_ACK,
  SUMMARY_ANCHOR_PREFIX,
} from './constants';
import { extractSummaryText, buildSummarizationPrompt } from './structured';
import { splitIntoChunks } from './chunks';
import { splitHistory, extractSummaryAnchor } from './splitter';
import { yieldToFrame, estimateTokens, messagesToText } from './text';

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
  /**
   * Chunk size (estimated tokens) above which the transcript is summarized
   * map-reduce style.  Defaults to `DEFAULT_MAX_CHUNK_TOKENS` (16 000).
   */
  maxChunkTokens?: number;
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
    const reader = result.getReader();
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

  return { text: result.text, thinking: result.thinking };
}

/**
 * Summarize a transcript, chunking it map-reduce style when it exceeds
 * `maxChunkTokens`.  Each chunk is summarized independently; subsequent
 * chunks fold into the running summary incrementally.
 */
async function summarizeTranscript(
  anchor: { readonly previousSummary: string } | null,
  messages: readonly AgentMessage[],
  config: SummarizeConfig,
): Promise<{ text: string; thinking: string | undefined }> {
  const chunks = splitIntoChunks(messages, config.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS);

  if (chunks.length === 1) {
    const prompt = buildSummarizationPrompt(
      anchor,
      messagesToText(chunks[0]),
      config.summaryPrompt,
      config.incrementalSummaryPrompt,
    );
    return callSummarizationHandler(config.handler, [{ role: 'user', content: prompt }], config.signal);
  }

  let running: string = anchor?.previousSummary ?? '';
  let thinking: string | undefined;
  for (const chunk of chunks) {
    const prompt = buildSummarizationPrompt(
      running ? { previousSummary: running } : null,
      messagesToText(chunk),
      config.summaryPrompt,
      config.incrementalSummaryPrompt,
    );
    const response = await callSummarizationHandler(
      config.handler,
      [{ role: 'user', content: prompt }],
      config.signal,
    );
    if (!response.text) throw new Error('Empty summary returned');
    running = response.text;
    thinking = response.thinking;
  }
  return { text: running, thinking };
}

/**
 * Summarize the older portion of a conversation history.
 *
 * Detects and merges any existing summary anchor (incremental mode), finds a
 * structurally safe split point, invokes the handler with tools disabled, and
 * replaces the old messages with a `[Context summary]` / `Understood.` pair.
 *
 * User messages are preserved verbatim (they are never summarized away — only
 * assistant/tool messages feed the summary) and are re-inserted directly after
 * the anchor, so no user content can be lost during compaction.
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

  const split = splitHistory(effectiveHistory, keepRecent);
  if (!split) return noOp;

  // User messages pass through verbatim; only assistant/tool messages are
  // eligible for summarization.
  const userMessages = split.old.filter((m) => m.role === 'user');
  const summarizable = split.old.filter((m) => m.role !== 'user');
  if (summarizable.length === 0) return noOp;

  await yieldToFrame();
  const oldTokens = estimateTokens(messagesToText(summarizable));

  // Pre-flight estimate: bail if the expected saving is too small to justify a
  // full LLM call, regardless of anchor overhead.
  if (minSaved > 0 && oldTokens < minSaved) return noOp;

  let summaryText: string;
  let summaryThinking: string | undefined;
  try {
    const response = await summarizeTranscript(anchor, summarizable, config);
    summaryText = extractSummaryText(response.text);
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
  const anchorTokens =
    estimateTokens(summaryText) + estimateTokens(SUMMARY_ANCHOR_ACK);
  const priorAnchorTokens = estimateTokens(anchor?.previousSummary ?? '');
  const savedTokens = Math.max(0, oldTokens + priorAnchorTokens - anchorTokens);

  // Final savings gate: ensure the net saving meets the minimum threshold.
  if (savedTokens < minSaved) return noOp;

  const compacted: AgentMessage[] = [
    { role: 'user', content: `${SUMMARY_ANCHOR_PREFIX}${summaryText}` },
    // Attach the thinking produced during summarization so that thinking-mode
    // models (DeepSeek, Doubao, etc.) receive the required reasoning_content
    // echo for this synthetic assistant turn on subsequent API calls.
    {
      role: 'assistant',
      content: SUMMARY_ANCHOR_ACK,
      ...(summaryThinking != null ? { thinking: summaryThinking } : {}),
    },
    ...userMessages,
    ...split.recent,
  ];

  return { messages: compacted, savedTokens };
}
