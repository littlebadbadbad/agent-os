/**
 * src/tools/historyTracker.ts — HistoryTracker
 *
 * Unified dual-buffer history tracker shared by the main agent and sub-agent
 * execution paths.  Both maintain the same invariant:
 *
 *   `liveHistory` — the LLM context, which may be compacted between turns.
 *   `fullHistory` — the append-only complete record, never compacted.
 *   `turnStart`   — boundary into `liveHistory`; messages from this index
 *                    onward were added during the current turn.
 *
 * ## Why this exists
 *
 * The identical `live` / `full` / `turnStart` triplet was duplicated across:
 *   - `src/client/agentSession.ts` (lines 57–70, 103–143, 220–240)
 *   - `src/tools/subagent/registryConversation.ts` (MutableConvState + getState/getHistory)
 *   - `src/tools/subagent/registryExecution.ts` (executeConversation, onAfterTurn, reconcile)
 *
 * Extracting the triplet into a single module eliminates ~30 lines of
 * duplicated buffer-management logic and guarantees both paths stay in sync.
 *
 * All methods are synchronous and side-effect-free except for mutating the
 * internal arrays.
 */

import type { AgentMessage } from '@agent-type';

// ── Interface ────────────────────────────────────────────────────────────────

export interface HistoryTracker {
  /** Snapshot of the LLM context (may be compacted). */
  getLiveHistory(): AgentMessage[];
  /** Snapshot of the append-only complete record. */
  getFullHistory(): AgentMessage[];
  /** Current turn boundary — index into `liveHistory`. */
  getTurnStart(): number;
  /** Set the turn boundary. */
  setTurnStart(n: number): void;

  /**
   * Push a message to BOTH live and full history.
   * Used by `sendMessage` / `editAndSendMessage` to append the user turn.
   */
  pushToBoth(msg: AgentMessage): void;

  /**
   * Replace BOTH live and full history with new arrays.
   * Used by `editAndSendMessage` after `truncateAtUserMessage`.
   */
  replaceBoth(live: AgentMessage[], full: AgentMessage[]): void;

  /**
   * Advance the turn:
   *   1. Copy messages from `live[turnStart..]` into `full`.
   *   2. Reset `turnStart` to the new live length.
   *   3. Optionally replace `live` with `newLive` (e.g. after compaction).
   *
   * Call inside `onAfterTurn` before (or as part of) history replacement.
   */
  advanceTurn(newLive?: AgentMessage[]): void;

  /**
   * Append messages to `full` only and advance `turnStart`.
   * Used by `onBeforeInvoke` to persist injected (queued) messages without
   * mutating `live` (the LLM loop handles live injection separately).
   */
  injectToFull(msgs: AgentMessage[]): void;

  /**
   * Ensure `full` contains everything in `live`.
   * Called in `finally` blocks after abort to close the gap between
   * `full` (monotonically appended to during turns) and `live` (replaced
   * by the loop result).
   */
  reconcile(): void;

  /**
   * Seal orphaned tool calls in both buffers.
   *
   * An "orphaned" tool call is one where an `assistant` message has
   * `toolCalls` but the matching `tool` results are absent from the
   * history (e.g. because a snapshot was saved mid-turn before tool
   * results arrived, then restored on page refresh).
   *
   * This method inserts synthetic `tool` messages with
   * `{ cancelled: true }` results so the message sequence is valid
   * for API consumption.
   */
  sealOrphanedToolCalls(): void;

  /**
   * Replace the content of a tool result message identified by toolCallId.
   * Updates both `live` and `full` buffers in-place.
   *
   * Returns `true` if a matching message was found and replaced, `false`
   * if no tool result with that toolCallId exists.
   *
   * Needed when a session is restored with pending user inputs: the
   * constructor seals orphaned tool calls with `{cancelled:true}`, but
   * later the real answer arrives via the restored prompt.  Replacing
   * the synthetic result avoids duplicate tool messages with the same
   * toolCallId, which would cause API errors.
   */
  replaceToolResult(toolCallId: string, content: unknown): boolean;

  /** Reset both histories to empty. */
  reset(): void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createHistoryTracker(
  initialMessages?: readonly AgentMessage[],
  liveHistory?: readonly AgentMessage[],
): HistoryTracker {
  // `live` — the LLM context. On restore, starts as `liveHistory` so that a
  // long `fullHistory` doesn't immediately overflow the model's context window.
  let live: AgentMessage[] = liveHistory
    ? [...liveHistory]
    : initialMessages
      ? [...initialMessages]
      : [];

  // `full` — append-only complete record. Starts from `initialMessages`.
  let full: AgentMessage[] = initialMessages ? [...initialMessages] : [];

  let turnStart = 0;

  // Seal any orphaned tool calls from restored snapshots immediately.
  // This handles the case where a snapshot was saved mid-turn before
  // tool results arrived — on page refresh, the orphaned tool_calls
  // would cause API errors without this fix.
  sealOrphanedToolCallsInPlace(live);
  sealOrphanedToolCallsInPlace(full);

  return {
    getLiveHistory(): AgentMessage[] {
      return [...live];
    },
    getFullHistory(): AgentMessage[] {
      return [...full];
    },
    getTurnStart(): number {
      return turnStart;
    },
    setTurnStart(n: number): void {
      turnStart = n;
    },

    pushToBoth(msg: AgentMessage): void {
      live.push(msg);
      full.push(msg);
    },

    replaceBoth(newLive: AgentMessage[], newFull: AgentMessage[]): void {
      live = newLive;
      full = newFull;
    },

    advanceTurn(newLive?: AgentMessage[]): void {
      // Flush messages added since the last boundary.
      // When `newLive` is provided (the loop's output via onAfterTurn),
      // we slice from `newLive` because `live` has not been updated
      // during the loop — `runAgentLoopCore` maintains its own internal
      // history copy.
      const source = newLive ?? live;
      full.push(...source.slice(turnStart));
      if (newLive) {
        live = newLive;
      }
      turnStart = live.length;
    },

    injectToFull(msgs: AgentMessage[]): void {
      full.push(...msgs);
      turnStart += msgs.length;
    },

    reconcile(): void {
      if (full.length < live.length) {
        full.push(...live.slice(full.length));
      }
    },

    sealOrphanedToolCalls(): void {
      sealOrphanedToolCallsInPlace(live);
      sealOrphanedToolCallsInPlace(full);
    },

    replaceToolResult(toolCallId: string, content: unknown): boolean {
      let found = false;
      for (const arr of [live, full]) {
        for (let i = 0; i < arr.length; i++) {
          const m = arr[i];
          if (m.role !== 'tool') continue;
          if (m.toolCallId !== toolCallId) continue;
          arr[i] = { role: 'tool', toolCallId: m.toolCallId, name: m.name, content };
          found = true;
          break;
        }
      }
      return found;
    },

    reset(): void {
      live = [];
      full = [];
      turnStart = 0;
    },
  };
}

// ── Orphaned tool call sealing ────────────────────────────────────────────────

/**
 * Find assistant messages with `toolCalls` that have no matching `tool`
 * results in the array, and insert synthetic "cancelled" tool results.
 *
 * This handles the case where a snapshot was saved mid-turn (before tool
 * results arrived) and then restored on page refresh — without this fix,
 * the orphaned `tool_calls` would cause API errors like:
 * "An assistant message with 'tool_calls' must be followed by tool messages".
 *
 * @param msgs - The message array to fix in place.
 */
function sealOrphanedToolCallsInPlace(msgs: AgentMessage[]): void {
  // Collect all tool call IDs that already have results.
  const toolCallIdsWithResults = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'tool' && m.toolCallId) {
      toolCallIdsWithResults.add(m.toolCallId);
    }
  }

  // Scan for assistant messages with orphaned tool calls and insert
  // synthetic cancelled results.
  const result: AgentMessage[] = [];
  for (const m of msgs) {
    result.push(m);
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        if (tc.id && !toolCallIdsWithResults.has(tc.id)) {
          // Mark as having results now so we don't insert duplicates
          // if a tool call ID appears in multiple assistant messages.
          toolCallIdsWithResults.add(tc.id);
          result.push({
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: JSON.stringify({ cancelled: true }),
          });
        }
      }
    }
  }

  // Replace in place so the caller's reference remains valid.
  msgs.length = 0;
  msgs.push(...result);
}
