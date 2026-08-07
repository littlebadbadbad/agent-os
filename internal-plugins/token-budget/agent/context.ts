/**
 * internal-plugins/token-budget/agent/context.ts — Context-window analysis
 *
 * Breaks a conversation history down into token usage by role/type and builds
 * the pressure hint injected into the system prompt.  Pure functions with no
 * side effects, extracted from the ToolSet so they stay independently testable.
 */

import type { AgentMessage } from '@agent-type';
import { estimateTokens, serializeContent } from './summarize/text';

/** Token breakdown of a conversation history by role and content type. */
export type ContextBreakdown = {
  readonly total: number;
  readonly userTokens: number;
  readonly assistantTextTokens: number;
  readonly toolCallTokens: number;
  readonly toolResultTokens: number;
  readonly thinkingTokens: number;
  readonly topToolResults: readonly { name: string; tokens: number }[];
};

/** Breakdown used when no history has been analysed yet (all counters zero). */
export const EMPTY_BREAKDOWN: ContextBreakdown = {
  total: 0,
  userTokens: 0,
  assistantTextTokens: 0,
  toolCallTokens: 0,
  toolResultTokens: 0,
  thinkingTokens: 0,
  topToolResults: [],
};

/**
 * Analyse a conversation history and return a token-breakdown by role/type.
 * Uses `estimateTokens` for fast approximation (no model round-trip).
 */
export function analyzeContext(history: readonly AgentMessage[]): ContextBreakdown {
  let userTokens = 0;
  let assistantTextTokens = 0;
  let toolCallTokens = 0;
  let toolResultTokens = 0;
  let thinkingTokens = 0;
  const toolResultMap = new Map<string, number>();

  for (const msg of history) {
    if (msg.role === 'user') {
      userTokens += estimateTokens(msg.content);
    } else if (msg.role === 'assistant') {
      assistantTextTokens += estimateTokens(msg.content);
      thinkingTokens += estimateTokens(msg.thinking ?? '');
      for (const call of msg.toolCalls ?? []) {
        toolCallTokens += estimateTokens(JSON.stringify(call.arguments));
      }
    } else {
      const tokens = estimateTokens(serializeContent(msg.content));
      toolResultTokens += tokens;
      toolResultMap.set(msg.name, (toolResultMap.get(msg.name) ?? 0) + tokens);
    }
  }

  const topToolResults = [...toolResultMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, tokens]) => ({ name, tokens }));

  const total =
    userTokens + assistantTextTokens + toolCallTokens + toolResultTokens + thinkingTokens;

  return {
    total,
    userTokens,
    assistantTextTokens,
    toolCallTokens,
    toolResultTokens,
    thinkingTokens,
    topToolResults,
  };
}

/**
 * Build a context-aware pressure hint string from the breakdown.
 * Picks the dominant contributor so the model knows what to trim first.
 *
 * A missing breakdown (`undefined`) falls back to an empty breakdown, which
 * yields a generic "keep responses concise" hint.
 */
export function buildContextHint(pct: number, breakdown: ContextBreakdown | undefined): string {
  const { total, toolResultTokens, assistantTextTokens, userTokens, thinkingTokens, topToolResults } = breakdown ?? EMPTY_BREAKDOWN;
  if (total === 0) return `[Context window ${pct}% full — keep responses concise.]`;

  const trPct = Math.round((toolResultTokens / total) * 100);
  const atPct = Math.round((assistantTextTokens / total) * 100);
  const uPct = Math.round((userTokens / total) * 100);
  const thkPct = Math.round((thinkingTokens / total) * 100);

  const parts: string[] = [`Context window ${pct}% full`];

  if (trPct > 50 && topToolResults.length > 0) {
    const top = topToolResults[0];
    const topStr = `largest: ${top.name} ~${Math.round(top.tokens / 1000 * 10) / 10}k`;
    parts.push(`tool results: ${trPct}% (${topStr}). Avoid re-reading files already in context`);
  } else if (atPct > 40) {
    parts.push(`assistant text: ${atPct}%. Keep responses concise and avoid unnecessary preamble`);
  } else if (uPct > 30) {
    parts.push(`user messages: ${uPct}%. Reference previous context instead of repeating details`);
  } else if (thkPct > 30) {
    parts.push(`thinking: ${thkPct}%. Reduce reasoning verbosity for straightforward steps`);
  } else {
    parts.push('wrap up the current task promptly and avoid unnecessary elaboration');
  }

  return `[${parts.join(' — ')}.]`;
}
