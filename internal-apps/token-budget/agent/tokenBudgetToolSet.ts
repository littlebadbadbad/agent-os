/**
 * internal-apps/token-budget/agent/tokenBudgetToolSet.ts — Token Budget ToolSet
 *
 * A self-contained ToolSet that tracks token usage and compacts conversation
 * history through a staged pipeline:
 *
 * 1. **Tool-result clearing** (zero LLM round-trips) — replaces stale tool
 *    results with a placeholder when context pressure crosses the threshold.
 * 2. **Graded summarization** (soft / hard / emergency) — LLM-generated
 *    structured summary with user messages preserved verbatim and map-reduce
 *    chunking for very long histories.
 *
 * The heavy lifting lives in `context.ts` (analysis) and `compaction.ts`
 * (strategies); this file only wires lifecycle hooks and state.
 *
 * ### Usage
 * ```ts
 * import { createTokenBudgetToolSet } from './tokenBudgetToolSet';
 *
 * const tokenBudget = createTokenBudgetToolSet(() => {
 *   const { contextWindow } = providerStore.getSelectedModel();
 *   return contextWindow
 *     ? { maxTokens: contextWindow, warningThreshold: 0.7, summarizationThreshold: 0.85 }
 *     : undefined;
 * });
 * ```
 *
 * ### Compaction pipeline
 *
 * When `usageRatio` crosses `summarizationThreshold`, the ToolSet first tries
 * the cheapest strategy (tool-result clearing, no LLM call), then attempts
 * graded summarization stages ordered by how full the context window is:
 *
 * | Stage     | Default ratio | keepRecent | Description                          |
 * |-----------|---------------|------------|--------------------------------------|
 * | Soft      | ≥ 0.85        | 4          | Normal — preserve recent context     |
 * | Hard      | ≥ 0.92        | 2          | Aggressive — minimal recent buffer   |
 * | Emergency | ≥ 0.97        | 1          | Nuclear — keep only last message     |
 *
 * Each stage is only attempted if the previous one saved fewer tokens than
 * `minSavedTokens`.  Once any stage succeeds, the remaining stages are skipped.
 *
 * A cooldown period (configurable via `TokenBudgetConfig.cooldownTurns`,
 * default 2) prevents repeated compactions on consecutive turns.
 *
 * ### System-prompt pressure hints
 * The `onGetSystemPrompt` hook injects a brief note about context pressure
 * into every turn's system prompt when usage crosses `warningThreshold`.
 * This encourages the model to keep its responses concise before compaction
 * becomes necessary.
 *
 * ### Symbol state
 * Returns `{ type: 'tokenBudget', tokenBudget, slots }` via `onGetSymbolState`,
 * stored under `state[TOKEN_BUDGET_SYMBOL]` — isolated from root state.
 *
 * ### Tracker lifecycle
 * - **Main agent sessions**: one tracker per session, created in `onInit`,
 *   deleted (and recreated fresh) in `onReset` (user clears history).
 * - **Sub-agent conversations**: one tracker per conversation, created lazily on
 *   the first `onAfterTurn` call, deleted in `onRemove`.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

import { createTokenTracker } from './tokenTracker';
import { summarizeHistory } from './summarize';
import { analyzeContext, buildContextHint } from './context';
import { clearToolResults, buildStages } from './compaction';
import { ctxKey } from '@agent-type';

import type {
  ToolSet,
  ToolSetContext,
  CompactionResult,
  CompactionNotice,
  AgentMessage,
  TokenUsage,
  AgentHandler,
  SessionEntryData,
  SystemPromptContext,
  AppSlotDeclaration,
} from '@agent-type';
import type { ContextBreakdown } from './context';
import type {
  TokenBudgetConfig,
  TokenTracker,
  TokenBudgetState,
  TokenBudgetToolSetOptions,
  TokenBudgetSymbolState,
} from './types';

// ── Symbol ────────────────────────────────────────────────────────────────────

export const TOKEN_BUDGET_SYMBOL = Symbol('token-budget');

// ── Slot declarations ─────────────────────────────────────────────────────────

/**
 * Declare the app's UI injection points.  Registered via
 * `host.registerToolSet(toolSet, slots)` at activation time.
 */
export function getTokenBudgetSlotDeclarations(): readonly SlotDeclaration[] {
  return [
    {
      type: 'headerBar',
      containingWidth: '100%',
      containingHeight: '28px',
      // Only render the progress bar once real usage has been recorded.
      shouldRender: (_ctx, state) => {
        const budget = state?.tokenBudget;
        return budget != null && budget.usageRatio > 0;
      },
    },
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the UI notice shown after a successful compaction. */
function compactionNotice(savedTokens: number): CompactionNotice {
  return { content: `_Context compressed — ${savedTokens.toLocaleString()} tokens freed._` };
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a token-budget ToolSet.
 *
 * @param getConfig  Factory called lazily when a tracker needs to be created.
 *                   Return `undefined` to disable tracking for that invocation.
 * @param options    Static options for compaction thresholds and handler override.
 */
export function createTokenBudgetToolSet(
  getConfig: () => TokenBudgetConfig | undefined,
  options: TokenBudgetToolSetOptions = {},
): ToolSet {
  const {
    hardCompactionThreshold = 0.92,
    emergencyThreshold = 0.97,
    enableToolResultClearing = true,
    getSummarizationHandler,
  } = options;

  // Per-scope tracker instances, keyed by `ctxKey(ctx)`.
  const trackers = new Map<string, TokenTracker>();

  // Per-scope context breakdowns cached from the last onAfterTurn call.
  const breakdowns = new Map<string, ContextBreakdown>();

  // Per-scope subscriber sets, keyed by the same string key.
  // Stored separately so we can notify them even when the tracker is replaced.
  const subs = new Map<string, Set<() => void>>();

  // ── Internal helpers ───────────────────────────────────────────────────────

  function notify(key: string): void {
    const set = subs.get(key);
    if (set) for (const fn of set) fn();
  }

  /**
   * Create a tracker for `key`, wiring its `onUpdate` callback to notify
   * all subscribers for that key.  Returns `undefined` when `getConfig()`
   * returns `undefined`.
   */
  function buildTracker(key: string): TokenTracker | undefined {
    const config = getConfig();
    if (!config) return undefined;
    return createTokenTracker(config, {
      onUpdate: () => notify(key),
    });
  }

  /**
   * Return the existing tracker for `ctx`, or create a new one lazily.
   * Returns `undefined` when no config is available.
   */
  function getOrCreate(ctx: ToolSetContext): TokenTracker | undefined {
    const key = ctxKey(ctx);
    const existing = trackers.get(key);
    if (existing) return existing;
    const t = buildTracker(key);
    if (t) trackers.set(key, t);
    return t;
  }

  function deleteTracker(key: string): void {
    trackers.delete(key);
    breakdowns.delete(key);
    // Notify subscribers one final time so UI can reflect the cleared state.
    notify(key);
  }

  // ── ToolSet implementation ─────────────────────────────────────────────────

  const toolSet: ToolSet = {
    name: 'token-budget',
    symbol: TOKEN_BUDGET_SYMBOL,
    tools: [],

    // Pre-create the tracker eagerly for any scope — main session or sub-agent
    // conversation — so it is ready before the first turn.
    onInit(ctx: ToolSetContext, _entryData?: SessionEntryData): void {
      getOrCreate(ctx);
    },

    onRemove(ctx: ToolSetContext): void {
      deleteTracker(ctxKey(ctx));
    },

    onReset(ctx: ToolSetContext): void {
      deleteTracker(ctxKey(ctx));
      getOrCreate(ctx);
    },

    /**
     * Inject a context-pressure hint into the system prompt when usage crosses
     * the warning threshold.  This encourages the model to produce more concise
     * responses before compaction kicks in — the cheapest form of context relief.
     * When a breakdown is available from the last turn, the hint includes
     * composition-specific advice instead of a generic "wrap up" message.
     */
    onGetSystemPrompt(
      ctx: ToolSetContext,
      _promptCtx: SystemPromptContext,
      _toolSets: readonly ToolSet[],
    ): string | undefined {
      const key = ctxKey(ctx);
      const tracker = trackers.get(key);
      if (!tracker) return undefined;
      const st = tracker.getState();
      // Only inject after the first real turn so we have an actual pressure reading.
      if (st.turnCount === 0) return undefined;

      const pct = Math.round(st.usageRatio * 100);
      const softThreshold = getConfig()?.summarizationThreshold ?? 0.85;
      if (st.usageRatio >= softThreshold) {
        return buildContextHint(pct, breakdowns.get(key));
      }
      if (st.warning) {
        return `[Context window ${pct}% full — keep responses concise.]`;
      }
      return undefined;
    },

    /**
     * Return the symbol state for this ToolSet.  Stored under
     * `state[TOKEN_BUDGET_SYMBOL]`, isolating token budget state from the
     * root `AgentSessionState`.
     */
    onGetSymbolState(ctx: ToolSetContext): TokenBudgetSymbolState {
      const tracker = trackers.get(ctxKey(ctx));
      const state: TokenBudgetState | undefined = tracker?.getState();
      return {
        type: 'tokenBudget',
        tokenBudget: state,
      };
    },

    // Wire subscribers: when the tracker's state changes, call `fn` so the
    // session state subscription chain triggers a re-render.
    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      const key = ctxKey(ctx);
      let set = subs.get(key);
      if (!set) { set = new Set(); subs.set(key, set); }
      set.add(fn);
      return () => { set?.delete(fn); };
    },

    onBuildSnapshot(_ctx: ToolSetContext) {
      // Token budget is runtime-only — no persistence needed.
      return {};
    },

    /**
     * Record token usage and optionally compact history through the staged
     * pipeline: tool-result clearing first (zero LLM round-trips), then graded
     * summarization (soft → hard → emergency).
     *
     * Compaction is skipped when:
     * - No tracker or no usage data is available.
     * - The history is too short (≤ 5 messages).
     * - The abort signal has fired.
     * - The cooldown period has not yet elapsed since the last compaction.
     */
    async onAfterTurn(
      ctx: ToolSetContext,
      history: AgentMessage[],
      usage: TokenUsage | undefined,
      signal: AbortSignal,
      handler: AgentHandler,
    ): Promise<CompactionResult | void> {
      const tracker = getOrCreate(ctx);
      if (!tracker || !usage) return;

      const st = tracker.record(usage);

      // Cache a context breakdown for onGetSystemPrompt to use next turn.
      const key = ctxKey(ctx);
      breakdowns.set(key, analyzeContext(history));

      // Guard: abort, too short to meaningfully compact, or cooldown active.
      if (signal.aborted || history.length <= 5 || !tracker.canSummarize()) return;

      const config = getConfig();
      const softThreshold = config?.summarizationThreshold ?? 0.85;
      const minSaved = options.minSavedTokens ?? Math.max(200, Math.ceil(st.maxTokens * 0.03));
      const summarizationHandler = getSummarizationHandler?.(handler) ?? handler;

      // Stage 1 — tool-result clearing: zero LLM round-trips.
      if (enableToolResultClearing && !signal.aborted) {
        const cleared = clearToolResults(history, 4);
        if (cleared && cleared.savedTokens >= minSaved) {
          tracker.recordCompaction();
          tracker.adjustAfterSummarization(cleared.savedTokens);
          return { history: cleared.messages, notices: [compactionNotice(cleared.savedTokens)] };
        }
      }

      // Stage 2+ — graded summarization, least to most aggressive.
      const stages = buildStages(
        st.usageRatio,
        softThreshold,
        hardCompactionThreshold,
        emergencyThreshold,
        minSaved,
      );
      for (const stage of stages) {
        if (signal.aborted) break;
        try {
          const result = await summarizeHistory(history, {
            handler: summarizationHandler,
            signal,
            keepRecentMessages: stage.keepRecent,
            minSavedTokens: stage.minSaved,
          });
          if (result.savedTokens >= stage.minSaved) {
            tracker.recordCompaction();
            tracker.adjustAfterSummarization(result.savedTokens);
            return { history: result.messages, notices: [compactionNotice(result.savedTokens)] };
          }
        } catch {
          // Summarisation is best-effort; fall through to the next stage.
        }
      }
    },
  };

  return toolSet;
}
