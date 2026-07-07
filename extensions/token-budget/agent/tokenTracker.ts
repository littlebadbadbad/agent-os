/**
 * extensions/token-budget/agent/tokenTracker.ts — Token usage tracker
 *
 * Moved from src/tools/track/tokenTracker.ts.
 * No changes needed — only dependency is `TokenUsage` from `@agent-type`.
 */

import type { TokenUsage } from '@agent-type';

// ── Token usage tracking ─────────────────────────────────────────────────────

/**
 * Cumulative token budget and usage state.
 */
export type TokenBudgetState = {
  /** Configured maximum token budget. */
  maxTokens: number;
  /** Total prompt tokens consumed so far (cumulative — for cost tracking only, never decremented). */
  totalPromptTokens: number;
  /** Total completion tokens consumed so far (cumulative — for cost tracking only, never decremented). */
  totalCompletionTokens: number;
  /** Total tokens consumed so far (cumulative — for cost tracking only, never decremented). */
  totalTokens: number;
  /**
   * Prompt-token count reported by the most recent handler invocation.
   * This is the actual size of the last prompt sent to the model and is
   * used as the basis for `usageRatio` — it accurately reflects current
   * context-window pressure, unlike a cumulative sum that grows quadratically.
   * Adjusted downward after successful summarization.
   */
  lastPromptTokens: number;
  /**
   * Context-window usage ratio: `lastPromptTokens / maxTokens`, clamped to [0, 1].
   * Triggers `warning` and `shouldSummarize` thresholds.
   */
  usageRatio: number;
  /** Number of turns (handler invocations) recorded. */
  turnCount: number;
  /** `true` when `usageRatio >= warningThreshold`. */
  warning: boolean;
  /** `true` when `usageRatio >= summarizationThreshold`. */
  shouldSummarize: boolean;
  /**
   * Number of turns elapsed since the last successful summarization.
   * `Infinity` when no compaction has occurred yet.
   * Used by consumers to enforce a cooldown period between successive compactions.
   */
  sinceLastCompaction: number;
};

/**
 * Configuration for the token budget system.
 */
export type TokenBudgetConfig = {
  /**
   * Maximum token budget for the entire conversation.
   * Typical ranges: 4 096 (GPT-3.5), 128 000 (GPT-4o), 200 000 (Claude).
   */
  maxTokens: number;
  /**
   * Ratio at which a soft warning is emitted (0–1).
   * Defaults to `0.75` (75 %).
   */
  warningThreshold?: number;
  /**
   * Ratio at which automatic history summarization is triggered (0–1).
   * Defaults to `0.85` (85 %).
   */
  summarizationThreshold?: number;
  /**
   * Minimum number of turns that must elapse between successive compactions.
   * Prevents thrashing when context climbs back above the threshold immediately
   * after a summarization that freed only modest space.
   * Defaults to `2`.
   */
  cooldownTurns?: number;
};

/**
 * Callback signatures for token budget events.
 */
export type TokenBudgetCallbacks = {
  /** Fired on every `record()` call with the latest state. */
  onUpdate?: (state: TokenBudgetState) => void;
  /** Fired once when usage crosses the warning threshold. */
  onWarning?: (state: TokenBudgetState) => void;
  /** Fired once when usage crosses the summarization threshold. */
  onSummarizationNeeded?: (state: TokenBudgetState) => void;
};

export type TokenTracker = ReturnType<typeof createTokenTracker>;

/**
 * Create a standalone token usage tracker.
 *
 * The tracker accumulates token counts reported by the handler after each turn
 * and emits events when configurable thresholds are crossed.
 *
 * ### Usage
 * ```ts
 * const tracker = createTokenTracker(
 *   { maxTokens: 128_000, warningThreshold: 0.75, summarizationThreshold: 0.85 },
 *   {
 *     onWarning: (s) => console.warn(`Token budget at ${(s.usageRatio * 100).toFixed(0)}%`),
 *     onSummarizationNeeded: (s) => triggerSummarization(),
 *   },
 * );
 *
 * // After each handler response:
 * tracker.record({ promptTokens: 1200, completionTokens: 580, totalTokens: 1780 });
 * ```
 */
export function createTokenTracker(
  config: TokenBudgetConfig,
  callbacks?: TokenBudgetCallbacks,
) {
  const maxTokens = config.maxTokens;
  const warningThreshold = config.warningThreshold ?? 0.75;
  const summarizationThreshold = config.summarizationThreshold ?? 0.85;
  const cooldownTurns = config.cooldownTurns ?? 2;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let lastPromptTokens = 0;
  let turnCount = 0;
  let turnsSinceLastCompaction = Infinity;
  let warningFired = false;
  let summarizationFired = false;

  const subscribers = new Set<() => void>();
  let snapshot: TokenBudgetState = buildSnapshot();

  function buildSnapshot(): TokenBudgetState {
    // Use the most-recent prompt size as the pressure metric — it accurately
    // reflects how full the context window was on the last call, whereas a
    // cumulative sum would grow quadratically and trigger far too early.
    const usageRatio = maxTokens > 0 ? Math.min(lastPromptTokens / maxTokens, 1) : 0;
    return {
      maxTokens,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      lastPromptTokens,
      usageRatio,
      turnCount,
      warning: usageRatio >= warningThreshold,
      shouldSummarize: usageRatio >= summarizationThreshold,
      sinceLastCompaction: turnsSinceLastCompaction,
    };
  }

  function notify(): void {
    snapshot = buildSnapshot();
    callbacks?.onUpdate?.(snapshot);
    subscribers.forEach((fn) => fn());
  }

  function record(usage: TokenUsage): TokenBudgetState {
    // Track the latest prompt size for context-window pressure measurement.
    lastPromptTokens = usage.promptTokens;
    // Accumulate totals for cost / spend tracking — never decremented.
    totalPromptTokens += usage.promptTokens;
    totalCompletionTokens += usage.completionTokens;
    totalTokens += usage.totalTokens;
    turnCount += 1;
    // Advance cooldown counter (saturate at Infinity when no compaction yet).
    if (turnsSinceLastCompaction !== Infinity) {
      turnsSinceLastCompaction += 1;
    }

    notify();

    const ratio = snapshot.usageRatio;

    if (!warningFired && ratio >= warningThreshold) {
      warningFired = true;
      callbacks?.onWarning?.(snapshot);
    }

    if (!summarizationFired && ratio >= summarizationThreshold) {
      summarizationFired = true;
      callbacks?.onSummarizationNeeded?.(snapshot);
    }

    return snapshot;
  }

  /**
   * Returns `true` when both conditions are met:
   * - The current context pressure exceeds `summarizationThreshold`.
   * - At least `cooldownTurns` have elapsed since the last compaction
   *   (or no compaction has occurred yet).
   *
   * Call this instead of reading `state.shouldSummarize` directly when you
   * want the cooldown gate enforced automatically.
   */
  function canSummarize(): boolean {
    const ratio = maxTokens > 0 ? Math.min(lastPromptTokens / maxTokens, 1) : 0;
    const aboveThreshold = ratio >= summarizationThreshold;
    const cooldownMet = turnsSinceLastCompaction >= cooldownTurns;
    return aboveThreshold && cooldownMet;
  }

  /**
   * Notify the tracker that a successful summarization has just occurred.
   *
   * Resets the inter-compaction cooldown counter and resets the one-shot
   * summarization callback gate so it can fire again if usage grows back.
   * Call this **after** a compaction succeeds (before calling
   * `adjustAfterSummarization` to drop the pressure estimate).
   */
  function recordCompaction(): void {
    turnsSinceLastCompaction = 0;
    summarizationFired = false;
    warningFired = snapshot.usageRatio >= warningThreshold;
    notify();
  }

  /**
   * Update the context-window pressure estimate after a successful summarization.
   *
   * `savedTokens` is the estimated number of tokens freed by replacing the
   * original history with a summary anchor pair.  Only `lastPromptTokens`
   * (the pressure metric) is adjusted — cumulative cost accumulators
   * (`totalPromptTokens`, `totalTokens`, `totalCompletionTokens`) are
   * intentionally left unchanged so spend tracking remains accurate.
   */
  function adjustAfterSummarization(savedTokens: number): void {
    lastPromptTokens = Math.max(0, lastPromptTokens - savedTokens);
    notify();
  }

  function reset(): void {
    totalPromptTokens = 0;
    totalCompletionTokens = 0;
    totalTokens = 0;
    lastPromptTokens = 0;
    turnCount = 0;
    turnsSinceLastCompaction = Infinity;
    warningFired = false;
    summarizationFired = false;
    notify();
  }

  function getState(): TokenBudgetState {
    return snapshot;
  }

  function subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    record,
    canSummarize,
    recordCompaction,
    adjustAfterSummarization,
    reset,
    getState,
    subscribe,
  };
}
