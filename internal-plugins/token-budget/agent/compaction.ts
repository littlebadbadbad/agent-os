/**
 * internal-plugins/token-budget/agent/compaction.ts — Compaction strategies
 *
 * Pure, side-effect-free compaction primitives:
 *
 * - `clearToolResults` — the lightest form of compaction: replaces old tool
 *   results with a placeholder, requiring zero LLM round-trips (mirrors
 *   Anthropic's server-side `clear_tool_uses` strategy).
 * - `buildStages` — derives the ordered list of summarization stages for a
 *   given context-window pressure, from least to most aggressive.
 */

import type { AgentMessage } from '@agent-type';
import { CLEARED_TOOL_RESULT } from './summarize/constants';
import { estimateTokens, serializeContent } from './summarize/text';
import { splitHistory } from './summarize/splitter';

/** The outcome of a successful compaction strategy. */
export type CompactResult = {
  /** Which strategy produced the compacted history. */
  readonly kind: 'tool-results-cleared' | 'summarized';
  /** The compacted message history. */
  readonly messages: AgentMessage[];
  /** Estimated tokens freed. */
  readonly savedTokens: number;
};

/** One summarization stage: how much recent history to keep and minimum savings. */
export type CompactionStage = {
  /** How many recent messages to preserve verbatim. */
  readonly keepRecent: number;
  /** Minimum estimated savings required for this stage to be declared successful. */
  readonly minSaved: number;
};

/**
 * Replace the tool results in the "old" portion of history with a placeholder.
 *
 * Zero LLM round-trips: assistant messages (including their tool calls) and
 * user messages are untouched, so the tool-call/tool-result pairing stays
 * structurally valid while freeing the tokens consumed by stale results.
 *
 * Returns `null` when there is nothing worth clearing.
 */
export function clearToolResults(
  history: readonly AgentMessage[],
  keepRecent: number,
): CompactResult | null {
  const split = splitHistory(history, keepRecent);
  if (!split) return null;

  let savedTokens = 0;
  const cleared = split.old.map((msg) => {
    if (msg.role !== 'tool') return msg;
    const current = estimateTokens(serializeContent(msg.content));
    const replaced = estimateTokens(CLEARED_TOOL_RESULT);
    if (current <= replaced) return msg;
    savedTokens += current - replaced;
    return { ...msg, content: CLEARED_TOOL_RESULT };
  });

  if (savedTokens <= 0) return null;
  return {
    kind: 'tool-results-cleared',
    messages: cleared.concat(split.recent),
    savedTokens,
  };
}

/**
 * Build the ordered list of summarization stages for the given pressure level.
 * Stages are ordered from least to most aggressive so the gentlest compaction
 * is attempted first and escalation happens only when it is insufficient.
 */
export function buildStages(
  usageRatio: number,
  softThreshold: number,
  hardThreshold: number,
  emergencyThreshold: number,
  minSaved: number,
): readonly CompactionStage[] {
  const stages: CompactionStage[] = [];
  if (usageRatio >= softThreshold) {
    stages.push({ keepRecent: 4, minSaved });
  }
  if (usageRatio >= hardThreshold) {
    stages.push({ keepRecent: 2, minSaved: Math.ceil(minSaved / 2) });
  }
  if (usageRatio >= emergencyThreshold) {
    stages.push({ keepRecent: 1, minSaved: 1 });
  }
  return stages;
}
