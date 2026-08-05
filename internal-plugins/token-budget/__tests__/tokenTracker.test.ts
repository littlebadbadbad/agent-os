import { describe, it, expect, vi } from 'vitest';
import { createTokenTracker } from '../agent/tokenTracker';

const usage = (promptTokens: number, completionTokens = 100) => ({
  promptTokens,
  completionTokens,
  totalTokens: promptTokens + completionTokens,
});

describe('createTokenTracker', () => {
  // ── Initial state ──────────────────────────────────────────────────────────

  it('returns a state with all zeros initially', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    const state = tracker.getState();
    expect(state.totalPromptTokens).toBe(0);
    expect(state.totalCompletionTokens).toBe(0);
    expect(state.totalTokens).toBe(0);
    expect(state.lastPromptTokens).toBe(0);
    expect(state.usageRatio).toBe(0);
    expect(state.turnCount).toBe(0);
    expect(state.warning).toBe(false);
    expect(state.shouldSummarize).toBe(false);
  });

  it('exposes the configured maxTokens', () => {
    const tracker = createTokenTracker({ maxTokens: 50_000 });
    expect(tracker.getState().maxTokens).toBe(50_000);
  });

  // ── record() ──────────────────────────────────────────────────────────────

  it('accumulates totals across multiple record() calls', () => {
    const tracker = createTokenTracker({ maxTokens: 100_000 });
    tracker.record(usage(1_000, 200));
    tracker.record(usage(2_000, 400));
    const state = tracker.getState();
    expect(state.totalPromptTokens).toBe(3_000);
    expect(state.totalCompletionTokens).toBe(600);
    expect(state.totalTokens).toBe(3_600);
    expect(state.turnCount).toBe(2);
  });

  it('uses lastPromptTokens (not cumulative sum) for usageRatio', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(3_000));
    tracker.record(usage(5_000)); // second call is more relevant than sum
    const state = tracker.getState();
    // ratio = 5_000 / 10_000 = 0.5
    expect(state.usageRatio).toBeCloseTo(0.5);
    expect(state.lastPromptTokens).toBe(5_000);
  });

  it('clamps usageRatio to 1.0 when over budget', () => {
    const tracker = createTokenTracker({ maxTokens: 1_000 });
    tracker.record(usage(2_000));
    expect(tracker.getState().usageRatio).toBe(1);
  });

  it('returns 0 usageRatio when maxTokens is 0', () => {
    const tracker = createTokenTracker({ maxTokens: 0 });
    tracker.record(usage(5_000));
    expect(tracker.getState().usageRatio).toBe(0);
  });

  // ── Thresholds ─────────────────────────────────────────────────────────────

  it('sets warning=true when usageRatio crosses warningThreshold (default 0.75)', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(7_000)); // 70% — no warning
    expect(tracker.getState().warning).toBe(false);
    tracker.record(usage(7_600)); // 76% — warning
    expect(tracker.getState().warning).toBe(true);
  });

  it('respects a custom warningThreshold', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000, warningThreshold: 0.5 });
    tracker.record(usage(4_500)); // 45% — ok
    expect(tracker.getState().warning).toBe(false);
    tracker.record(usage(5_100)); // 51% — warning
    expect(tracker.getState().warning).toBe(true);
  });

  it('sets shouldSummarize=true when usageRatio crosses summarizationThreshold (default 0.85)', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(8_400)); // 84% — not yet
    expect(tracker.getState().shouldSummarize).toBe(false);
    tracker.record(usage(8_600)); // 86% — trigger
    expect(tracker.getState().shouldSummarize).toBe(true);
  });

  // ── Callbacks ─────────────────────────────────────────────────────────────

  it('calls onUpdate on every record()', () => {
    const onUpdate = vi.fn();
    const tracker = createTokenTracker({ maxTokens: 10_000 }, { onUpdate });
    tracker.record(usage(1_000));
    tracker.record(usage(2_000));
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('fires onWarning exactly once when threshold is crossed', () => {
    const onWarning = vi.fn();
    const tracker = createTokenTracker({ maxTokens: 10_000, warningThreshold: 0.5 }, { onWarning });
    tracker.record(usage(4_000)); // 40% — no fire
    tracker.record(usage(6_000)); // 60% — fires
    tracker.record(usage(7_000)); // 70% — already fired, no second call
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it('fires onSummarizationNeeded exactly once', () => {
    const onSummarizationNeeded = vi.fn();
    const tracker = createTokenTracker(
      { maxTokens: 10_000, summarizationThreshold: 0.8 },
      { onSummarizationNeeded },
    );
    tracker.record(usage(7_900)); // 79%
    tracker.record(usage(8_100)); // 81% — fires
    tracker.record(usage(9_000)); // 90% — no second fire
    expect(onSummarizationNeeded).toHaveBeenCalledTimes(1);
  });

  // ── subscribe() ───────────────────────────────────────────────────────────

  it('notifies subscribers on record()', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    const listener = vi.fn();
    tracker.subscribe(listener);
    tracker.record(usage(500));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes correctly', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    const listener = vi.fn();
    const unsub = tracker.subscribe(listener);
    unsub();
    tracker.record(usage(500));
    expect(listener).not.toHaveBeenCalled();
  });

  // ── adjustAfterSummarization() ────────────────────────────────────────────

  it('reduces lastPromptTokens by savedTokens and recalculates ratio', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(9_000)); // 90% — shouldSummarize
    expect(tracker.getState().shouldSummarize).toBe(true);

    tracker.adjustAfterSummarization(4_000); // simulate freeing 4000 tokens
    const state = tracker.getState();
    expect(state.lastPromptTokens).toBe(5_000);
    expect(state.usageRatio).toBeCloseTo(0.5);
  });

  it('resets summarizationFired via recordCompaction() so it can fire again', () => {
    const onSummarizationNeeded = vi.fn();
    const tracker = createTokenTracker(
      { maxTokens: 10_000, summarizationThreshold: 0.8 },
      { onSummarizationNeeded },
    );
    tracker.record(usage(9_000)); // 90% — fires once
    tracker.recordCompaction();           // reset gate + cooldown
    tracker.adjustAfterSummarization(5_000); // ratio drops to 40%
    tracker.record(usage(8_500)); // 85% — fires again after reset
    expect(onSummarizationNeeded).toHaveBeenCalledTimes(2);
  });

  it('does NOT reset summarizationFired in adjustAfterSummarization alone', () => {
    const onSummarizationNeeded = vi.fn();
    const tracker = createTokenTracker(
      { maxTokens: 10_000, summarizationThreshold: 0.8 },
      { onSummarizationNeeded },
    );
    tracker.record(usage(9_000)); // 90% — fires once
    tracker.adjustAfterSummarization(5_000); // ratio drops, but gate NOT reset
    tracker.record(usage(8_500)); // 85% — already fired, does NOT fire again
    expect(onSummarizationNeeded).toHaveBeenCalledTimes(1);
  });

  it('does not modify totalPromptTokens or totalTokens in adjustAfterSummarization', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(9_000, 500)); // totalPromptTokens=9000, totalTokens=9500
    const before = tracker.getState();
    tracker.adjustAfterSummarization(4_000);
    const after = tracker.getState();
    // Cost accumulators must remain intact — they are for spend tracking.
    expect(after.totalPromptTokens).toBe(before.totalPromptTokens);
    expect(after.totalCompletionTokens).toBe(before.totalCompletionTokens);
    expect(after.totalTokens).toBe(before.totalTokens);
    // Only the pressure metric drops.
    expect(after.lastPromptTokens).toBe(5_000);
  });

  it('clamps lastPromptTokens to 0 if savedTokens > lastPromptTokens', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(1_000));
    tracker.adjustAfterSummarization(5_000); // clearing more than exists
    expect(tracker.getState().lastPromptTokens).toBe(0);
  });

  // ── canSummarize() & recordCompaction() ────────────────────────────────────

  it('canSummarize() returns true when above threshold and no prior compaction', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000, summarizationThreshold: 0.8 });
    tracker.record(usage(8_500)); // 85% — above threshold
    expect(tracker.canSummarize()).toBe(true);
  });

  it('canSummarize() returns false when below threshold', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000, summarizationThreshold: 0.8 });
    tracker.record(usage(7_500)); // 75% — below
    expect(tracker.canSummarize()).toBe(false);
  });

  it('canSummarize() returns false within cooldown window after recordCompaction()', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000, summarizationThreshold: 0.8, cooldownTurns: 2 });
    tracker.record(usage(9_000)); // above threshold
    tracker.recordCompaction();   // compaction happened
    tracker.record(usage(9_000)); // turn 1 since compaction — still in cooldown
    expect(tracker.canSummarize()).toBe(false);
    tracker.record(usage(9_000)); // turn 2 — cooldown elapsed
    expect(tracker.canSummarize()).toBe(true);
  });

  it('sinceLastCompaction is Infinity before any compaction', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    expect(tracker.getState().sinceLastCompaction).toBe(Infinity);
    tracker.record(usage(1_000));
    expect(tracker.getState().sinceLastCompaction).toBe(Infinity);
  });

  it('sinceLastCompaction increments after recordCompaction()', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(9_000));
    tracker.recordCompaction();
    expect(tracker.getState().sinceLastCompaction).toBe(0);
    tracker.record(usage(9_000));
    expect(tracker.getState().sinceLastCompaction).toBe(1);
    tracker.record(usage(9_000));
    expect(tracker.getState().sinceLastCompaction).toBe(2);
  });

  // ── reset() ───────────────────────────────────────────────────────────────

  it('resets all counters to zero', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    tracker.record(usage(3_000));
    tracker.reset();
    const state = tracker.getState();
    expect(state.totalPromptTokens).toBe(0);
    expect(state.totalCompletionTokens).toBe(0);
    expect(state.totalTokens).toBe(0);
    expect(state.lastPromptTokens).toBe(0);
    expect(state.usageRatio).toBe(0);
    expect(state.turnCount).toBe(0);
    expect(state.warning).toBe(false);
    expect(state.shouldSummarize).toBe(false);
    expect(state.sinceLastCompaction).toBe(Infinity);
  });

  it('allows thresholds to fire again after reset', () => {
    const onWarning = vi.fn();
    const tracker = createTokenTracker({ maxTokens: 10_000, warningThreshold: 0.5 }, { onWarning });
    tracker.record(usage(6_000)); // fires once
    tracker.reset();
    tracker.record(usage(6_000)); // should fire again after reset
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  // ── getState snapshot stability ───────────────────────────────────────────

  it('getState returns a stable reference between record() calls', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    const s1 = tracker.getState();
    const s2 = tracker.getState();
    expect(s1).toBe(s2); // same snapshot reference
  });

  it('getState returns a new reference after record()', () => {
    const tracker = createTokenTracker({ maxTokens: 10_000 });
    const s1 = tracker.getState();
    tracker.record(usage(100));
    const s2 = tracker.getState();
    expect(s1).not.toBe(s2);
  });
});
