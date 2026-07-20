/**
 * Delegation Nudge ToolSet
 *
 * A lightweight ToolSet that monitors tool-result volume per run and injects a
 * one-line reminder into the system prompt when the agent is producing large
 * tool outputs without delegating.
 *
 * The nudge fires when ≥ 3 tool results in the current run each exceeded 5 000
 * characters — a signal that the agent is doing a lot of data-heavy work
 * in its own context rather than offloading it to a sub-agent.
 *
 * This ToolSet has no tools of its own and contributes nothing to the system
 * prompt during "normal" runs, so its overhead is negligible.
 */

import type { ToolSet, ToolSetContext } from '@agent-type';
import type { ToolResult } from '@agent-type';

// ── Constants ─────────────────────────────────────────────────────────────────

const LARGE_RESULT_THRESHOLD = 5_000;   // chars
const NUDGE_TRIGGER_COUNT = 3;          // large results before nudge fires

const NUDGE_TEXT =
  '\n> **Delegation reminder:** you have processed several large tool results this turn. ' +
  'If the remaining work produces output you won\'t need raw in your context, ' +
  'consider using `delegate_*_task` to run it in a sub-agent instead.';

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the Delegation Nudge ToolSet.
 *
 * Register it on the agent alongside the sub-agent ToolSet.  It automatically
 * counts large tool results and appends a one-line delegation reminder to the
 * system prompt for the rest of the run when the threshold is crossed.
 *
 * No configuration is needed; the defaults work well for most agents.
 */
export function createDelegationNudgeToolSet(): ToolSet {
  // Per-session counters: number of large tool results seen this run.
  const runCounters = new Map<string, number>();

  function key(ctx: ToolSetContext): string {
    return ctx.sessionId;
  }

  return {
    name: 'delegation-nudge',
    tools: [],

    onBeforeRun(ctx: ToolSetContext): void {
      // Reset the counter at the start of each agent run.
      runCounters.set(key(ctx), 0);
    },

    onToolResult(ctx: ToolSetContext, _toolName: string, result: ToolResult): ToolResult {
      // Count tool results whose string representation exceeds the threshold.
      const value = result.result;
      const resultStr =
        typeof value === 'string'
          ? value
          : (value !== undefined ? JSON.stringify(value) : 'null');
      if (resultStr.length >= LARGE_RESULT_THRESHOLD) {
        const prev = runCounters.get(key(ctx)) ?? 0;
        runCounters.set(key(ctx), prev + 1);
      }
      // Always return the result unchanged — this hook is observers-only.
      return result;
    },

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const count = runCounters.get(key(ctx)) ?? 0;
      if (count >= NUDGE_TRIGGER_COUNT) {
        return NUDGE_TEXT;
      }
      return undefined;
    },
  };
}
