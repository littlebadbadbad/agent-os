/**
 * Unified conversation execution engine.
 *
 * Both the main `AgentSession` (`runInternalAgentLoop`) and the sub-agent
 * registry (`executeConversation`) follow the same loading-state lifecycle:
 *
 *   1. Fire `onBeforeRun`
 *   2. `isLoading = true` → notify subscribers
 *   3. Create AbortController → delegate to caller-provided `run` function
 *   4. Capture outcome (completed / max-turns / aborted / error)
 *   5. `isLoading = false` → notify subscribers
 *   6. Fire `onAfterRun`
 *
 * Steps 1–6 are identical in both paths.  Step 3 (the actual agent loop) is
 * customised per caller.
 */

import type { AgentRunOutcome } from '@agent-type';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Mutable references that the engine manages during execution.
 * The caller provides these (typically from its own closure state)
 * so the engine can toggle `isLoading` and store the abort controller.
 */
export type EngineRefs = {
  isLoading: boolean;
  abortController: AbortController | null;
};

/** Result returned by the caller-provided `run` function. */
export type EngineRunResult = {
  outcome: AgentRunOutcome;
};

/** Lifecycle hooks called by the engine. */
export type EngineHooks = {
  /** Called after concurrency guard passes, before isLoading=true. */
  onBeforeRun?: () => void;
  /** Called after isLoading is back to false and subscribers notified. */
  onAfterRun?: (outcome: AgentRunOutcome) => void;
};

/**
 * Execute a single conversation turn.
 *
 * Handles the loading-state lifecycle so both the main agent and sub-agent
 * paths share the same orchestration.
 *
 * The caller is responsible for:
 *   - Concurrency / intercept guards (checked before calling this function)
 *   - Pushing the user message to the history tracker
 *   - Setting `tracker.setTurnStart()`
 *   - Managing their own external `isLoading` state (e.g. `conv._state.isLoading`)
 *     **before** calling this function — the engine only manages `refs.isLoading`
 *     for flow control.
 *
 * @param refs    Mutable references (isLoading flag for engine flow, abortController).
 * @param hooks   Lifecycle callbacks.
 * @param run     The actual agent-loop execution.  Receives the AbortSignal
 *                and must return the final outcome.
 * @param notify  Synchronous callback to push state changes to all subscribers
 *                (called once after isLoading becomes true, once after false).
 */
export async function runEngine(
  refs: EngineRefs,
  hooks: EngineHooks,
  run: (signal: AbortSignal) => Promise<EngineRunResult>,
  notify: () => void,
): Promise<void> {
  // ── Pre-run ─────────────────────────────────────────────────────────────
  hooks.onBeforeRun?.();

  refs.isLoading = true;
  notify();

  // ── Run ─────────────────────────────────────────────────────────────────
  const controller = new AbortController();
  refs.abortController = controller;

  let outcome: AgentRunOutcome = 'error';

  try {
    const result = await run(controller.signal);
    outcome = result.outcome;
  } catch (err) {
    outcome = controller.signal.aborted ? 'aborted' : 'error';
    throw err;
  } finally {
    refs.abortController = null;
    refs.isLoading = false;
    notify();
    // Fire post-run hooks. Implementations (e.g. PendingInputToolSet) may
    // call sendMessage synchronously here — isLoading is already false
    // so the call goes through immediately and starts the next run.
    hooks.onAfterRun?.(outcome);
  }
}
