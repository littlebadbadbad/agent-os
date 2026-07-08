/**
 * History truncation utilities shared by both the main agent session and
 * sub-agent conversation editing.
 *
 * When editing a message (edit-and-send), we need to find the Nth user message
 * (1-based) in the full (never-compacted) history, then truncate both the LLM
 * context (`history`) and the append-only record (`fullHistory`) at that point
 * so the conversation can be re-run from the edited message.
 */

import type { AgentMessage } from '@agent-type';

/**
 * Result of truncating history at the Nth user message.
 */
export type TruncationResult = {
  /**
   * The index (0-based) in `fullHistory` where the Nth user message was found.
   * All messages at and after this index are discarded in both returned arrays.
   * -1 when the Nth user message was not found.
   */
  readonly userIndex: number;
  /** Truncated full history (messages strictly before the Nth user message). */
  readonly fullHistory: AgentMessage[];
  /** Truncated LLM context — a copy of `fullHistory` (resynced from scratch). */
  readonly history: AgentMessage[];
};

/**
 * Find the Nth user message (1-based) in `fullHistory` and truncate both
 * `fullHistory` and `history` at that point.
 *
 * Uses `fullHistory` (append-only) as the truth source — never the compacted
 * LLM context, which may contain synthetic `SUMMARY_ANCHOR_PREFIX` user
 * messages that don't correspond to real user input.
 *
 * @param fullHistory - The append-only record of every message in the conversation.
 * @param userCount - 1-based index of the user message to truncate at.
 * @returns A `TruncationResult` with `userIndex === -1` when not found.
 */
export function truncateAtUserMessage(
  fullHistory: readonly AgentMessage[],
  userCount: number,
): TruncationResult {
  let userIndex = -1;
  let found = 0;
  for (let i = 0; i < fullHistory.length; i++) {
    if (fullHistory[i].role === 'user') {
      found++;
      if (found === userCount) {
        userIndex = i;
        break;
      }
    }
  }

  if (userIndex === -1) {
    return { userIndex: -1, fullHistory: [], history: [] };
  }

  const truncatedFull = fullHistory.slice(0, userIndex);
  // Resync LLM context from fullHistory — drops any stale compaction anchors
  // that are no longer valid after the old branch is discarded.
  const truncatedHistory = [...truncatedFull];

  return {
    userIndex,
    fullHistory: truncatedFull,
    history: truncatedHistory,
  };
}
