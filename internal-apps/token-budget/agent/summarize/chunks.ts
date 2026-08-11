/**
 * internal-apps/token-budget/agent/summarize/chunks.ts — Transcript chunking
 *
 * Splits a message list into "turns" (a user or assistant message together with
 * any tool results that follow the assistant message) and packs those turns
 * into chunks under a token budget.  A turn is never split, so a tool-call /
 * tool-result pairing can never be broken across a chunk boundary.
 */

import type { AgentMessage } from '@agent-type';
import { estimateTokens, messagesToText } from './text';

/**
 * Group messages into turns.  A turn is a user or assistant message followed
 * by the tool-result messages that belong to the preceding assistant call.
 */
export function groupTurns(
  messages: readonly AgentMessage[],
): readonly (readonly AgentMessage[])[] {
  const turns: AgentMessage[][] = [];
  for (const msg of messages) {
    if (msg.role === 'tool' && turns.length > 0) {
      turns[turns.length - 1].push(msg);
    } else {
      turns.push([msg]);
    }
  }
  return turns;
}

/**
 * Pack turns into chunks whose estimated token count stays at or below
 * `maxTokens`.  A single over-sized turn forms a chunk of its own so that
 * structure is never sacrificed.
 */
export function splitIntoChunks(
  messages: readonly AgentMessage[],
  maxTokens: number,
): readonly (readonly AgentMessage[])[] {
  const chunks: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  let currentTokens = 0;

  for (const turn of groupTurns(messages)) {
    const turnTokens = estimateTokens(messagesToText(turn));
    if (current.length > 0 && currentTokens + turnTokens > maxTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current = current.concat(turn);
    currentTokens += turnTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
