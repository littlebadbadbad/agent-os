/**
 * extensions/token-budget/agent/tokenBudgetToolSet.ts — Token Budget ToolSet
 *
 * Moved from src/tools/track/tokenBudgetToolSet.ts.
 *
 * Key changes from the original:
 * - Uses `onGetSymbolState` instead of `onGetState` (isolated symbol state)
 * - Declares `symbol: TOKEN_BUDGET_SYMBOL` on the ToolSet
 * - Declares UI slot: headerBar (token progress bar)
 * - Imports `MAIN_CONVERSATION_ID` from `@agent-type` instead of `../toolSet`
 * - Imports `SessionEntryData` from `@agent-type` instead of `../../client/sessionManager.types`
 * - Module augmentation for `AgentSessionExtension.tokenBudget` removed —
 *   state is now isolated under the symbol key, not merged into root state
 *
 * A self-contained ToolSet that tracks token usage and automatically compacts
 * conversation history via summarisation when the configured budget threshold
 * is reached.
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
 * ### Compaction stages
 *
 * When `usageRatio` crosses `summarizationThreshold`, the ToolSet attempts
 * multi-stage history compaction.  Each stage is triggered by how full the
 * context window is:
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
 * - **Main agent sessions**: one tracker per session, created in `onInitSession`,
 *   deleted (and recreated fresh) in `onResetSession` (user clears history).
 * - **Sub-agent conversations**: one tracker per conversation, created lazily on
 *   the first `onAfterTurn` call (the registry does not invoke `onInitSession`
 *   per-conversation), deleted in `onRemoveSession`.
 */

// ── Imports ──────────────────────────────────────────────────────────────────

import { createTokenTracker } from './tokenTracker';
import { summarizeHistory, estimateTokens } from './summarize';
import { MAIN_CONVERSATION_ID } from '@agent-type';

import type {
  ToolSet,
  ToolSetContext,
  CompactionResult,
  CompactionNotice,
  AgentMessage,
  TokenUsage,
  AgentHandler,
  SessionEntryData,
  PluginStateExtension,
} from '@agent-type';
import type {
  TokenBudgetConfig,
  TokenTracker,
  TokenBudgetState,
  TokenBudgetToolSetOptions,
  TokenBudgetSymbolState,
} from './types';

// ── Symbol ────────────────────────────────────────────────────────────────────

export const TOKEN_BUDGET_SYMBOL = Symbol('token-budget');

// ── Context analysis ─────────────────────────────────────────────────────────

type ContextBreakdown = {
  total: number;
  userTokens: number;
  assistantTextTokens: number;
  toolCallTokens: number;
  toolResultTokens: number;
  thinkingTokens: number;
  topToolResults: Array<{ name: string; tokens: number }>;
};

/**
 * Analyse a conversation history and return a token-breakdown by role/type.
 * Uses `estimateTokens` for fast approximation (no model round-trip).
 */
function analyzeContext(history: AgentMessage[]): ContextBreakdown {
  let userTokens = 0;
  let assistantTextTokens = 0;
  let toolCallTokens = 0;
  let toolResultTokens = 0;
  let thinkingTokens = 0;
  const toolResultMap = new Map<string, number>();

  for (const msg of history) {
    if (msg.role === 'user') {
      // User messages may contain text or tool results
      if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ type: string; content?: string; tool_use_id?: string; name?: string }>) {
          if (part.type === 'tool_result') {
            const text = typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? '');
            const toks = estimateTokens(text);
            toolResultTokens += toks;
            const name = (part as { name?: string }).name ?? part.tool_use_id ?? 'unknown';
            toolResultMap.set(name, (toolResultMap.get(name) ?? 0) + toks);
          } else {
            const text = typeof part === 'string' ? part : ((part as { text?: string }).text ?? JSON.stringify(part));
            userTokens += estimateTokens(text);
          }
        }
      } else {
        userTokens += estimateTokens(String(msg.content ?? ''));
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ type: string; text?: string; thinking?: string; input?: unknown }>) {
          if (part.type === 'text') {
            assistantTextTokens += estimateTokens(part.text ?? '');
          } else if (part.type === 'thinking') {
            thinkingTokens += estimateTokens(part.thinking ?? '');
          } else if (part.type === 'tool_use') {
            toolCallTokens += estimateTokens(JSON.stringify(part.input ?? {}));
          }
        }
      } else {
        assistantTextTokens += estimateTokens(String(msg.content ?? ''));
      }
    }
  }

  const topToolResults = [...toolResultMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, tokens]) => ({ name, tokens }));

  const total = userTokens + assistantTextTokens + toolCallTokens + toolResultTokens + thinkingTokens;

  return { total, userTokens, assistantTextTokens, toolCallTokens, toolResultTokens, thinkingTokens, topToolResults };
}

/**
 * Build a context-aware pressure hint string from the breakdown.
 */
function buildContextHint(pct: number, breakdown: ContextBreakdown): string {
  const { total, toolResultTokens, assistantTextTokens, userTokens, thinkingTokens, topToolResults } = breakdown;
  if (total === 0) return `[Context window ${pct}% full — keep responses concise.]`;

  const trPct  = Math.round((toolResultTokens  / total) * 100);
  const atPct  = Math.round((assistantTextTokens / total) * 100);
  const uPct   = Math.round((userTokens         / total) * 100);
  const thkPct = Math.round((thinkingTokens     / total) * 100);

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

// ── Compaction stages ────────────────────────────────────────────────────────

type CompactionStage = {
  /** Minimum usageRatio for this stage to be attempted. */
  threshold: number;
  /** How many recent messages to preserve verbatim. */
  keepRecent: number;
  /**
   * Minimum savings required for this stage to be declared successful.
   * The emergency stage uses `1` to accept any non-zero saving.
   */
  minSaved: number;
};

// ── Key helpers ──────────────────────────────────────────────────────────────

/**
 * Canonical string key for per-scope tracker storage.
 *
 * - Main agent session:      `sessionId`
 * - Sub-agent conversation:  `${sessionId}:${agentName}:${conversationId}`
 *
 * Sub-agent conversations each get an independent tracker so their token
 * progress bars and summarisation triggers are isolated.
 */
function trackerKey(ctx: ToolSetContext): string {
  return ctx.conversationId === MAIN_CONVERSATION_ID
    ? ctx.sessionId
    : `${ctx.sessionId}:${ctx.agentName}:${ctx.conversationId}`;
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
    getSummarizationHandler,
  } = options;

  // Per-scope tracker instances, keyed by `trackerKey(ctx)`.
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
    const key = trackerKey(ctx);
    if (trackers.has(key)) return trackers.get(key)!;
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

  /**
   * Build the ordered list of compaction stages for the given pressure level.
   * Each stage is only included when the current usageRatio meets its threshold.
   * Stages are ordered from least to most aggressive so we try the gentlest
   * compaction first and escalate only if it is insufficient.
   */
  function buildStages(
    usageRatio: number,
    softThreshold: number,
    minSaved: number,
  ): CompactionStage[] {
    const stages: CompactionStage[] = [];
    if (usageRatio >= softThreshold) {
      stages.push({ threshold: softThreshold, keepRecent: 4, minSaved });
    }
    if (usageRatio >= hardCompactionThreshold) {
      stages.push({ threshold: hardCompactionThreshold, keepRecent: 2, minSaved: Math.ceil(minSaved / 2) });
    }
    if (usageRatio >= emergencyThreshold) {
      stages.push({ threshold: emergencyThreshold, keepRecent: 1, minSaved: 1 });
    }
    return stages;
  }

  // ── ToolSet implementation ─────────────────────────────────────────────────

  const toolSet: ToolSet = {
    name: 'token-budget',
    symbol: TOKEN_BUDGET_SYMBOL,
    tools: [],

    // Pre-create the tracker for a main-agent session so it's ready before
    // the first turn.  Sub-agent conversation trackers are created lazily in
    // `onAfterTurn` because the registry does not call `onInitSession` per-
    // conversation.
    // Create tracker eagerly for any scope — main session (on init) or
    // sub-agent conversation (on init).  The key function `trackerKey(ctx)`
    // ensures isolation across scopes with no need for MAIN_CONVERSATION_ID
    // checks.
    onInit(ctx: ToolSetContext, _entryData?: SessionEntryData): void {
      getOrCreate(ctx);
    },

    onRemove(ctx: ToolSetContext): void {
      deleteTracker(trackerKey(ctx));
    },

    onReset(ctx: ToolSetContext): void {
      deleteTracker(trackerKey(ctx));
      getOrCreate(ctx);
    },

    /**
     * Inject a context-pressure hint into the system prompt when usage crosses
     * the warning threshold.  This encourages the model to produce more concise
     * responses before compaction kicks in — the cheapest form of context relief.
     * When a breakdown is available from the last turn, the hint includes
     * composition-specific advice instead of a generic "wrap up" message.
     */
    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const key = trackerKey(ctx);
      const tracker = trackers.get(key);
      if (!tracker) return undefined;
      const st = tracker.getState();
      // Only inject after the first real turn so we have an actual pressure reading.
      if (st.turnCount === 0) return undefined;

      const pct = Math.round(st.usageRatio * 100);
      const softThreshold = getConfig()?.summarizationThreshold ?? 0.85;
      if (st.usageRatio >= softThreshold) {
        const breakdown = breakdowns.get(key);
        return breakdown
          ? buildContextHint(pct, breakdown)
          : `[Context window ${pct}% full — wrap up the current task promptly and avoid unnecessary elaboration.]`;
      }
      if (st.warning) {
        return `[Context window ${pct}% full — keep responses concise.]`;
      }
      return undefined;
    },

    /**
     * Return the symbol state for this ToolSet.
     *
     * The returned object is stored under `state[TOKEN_BUDGET_SYMBOL]`,
     * isolating token budget state from the root `AgentSessionState`.
     * The `slots` array declares a `headerBar` slot that renders the
     * token progress bar.
     */
    onGetSymbolState(ctx: ToolSetContext): TokenBudgetSymbolState {
      const tracker = trackers.get(trackerKey(ctx));
      const state: TokenBudgetState | undefined = tracker?.getState();
      return {
        type: 'tokenBudget',
        tokenBudget: state,
        slots: [
          {
            type: 'headerBar',
            containingWidth: '100%',
            containingHeight: '28px',
            shouldRender: () => state?.usageRatio != null && state.usageRatio > 0,
          },
        ],
      };
    },

    // Wire subscribers: when the tracker's state changes, call `fn` so the
    // session state subscription chain triggers a re-render.
    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      const key = trackerKey(ctx);
      let set = subs.get(key);
      if (!set) { set = new Set(); subs.set(key, set); }
      set.add(fn);
      return () => set!.delete(fn);
    },

    onBuildSnapshot(_ctx: ToolSetContext) {
      // Token budget is runtime-only — no persistence needed.
      return {};
    },

    /**
     * Record token usage and optionally compact history via multi-stage summarisation.
     *
     * Called by both the main-agent loop and each sub-agent loop after every
     * turn.  For sub-agents the tracker is created lazily here.
     *
     * Compaction is skipped when:
     * - No tracker or no usage data is available.
     * - The history is too short (≤ 5 messages).
     * - The abort signal has fired.
     * - The cooldown period has not yet elapsed since the last compaction.
     *
     * When compaction is attempted, stages are tried from least to most
     * aggressive.  The first stage that saves enough tokens wins.
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
      const key = trackerKey(ctx);
      breakdowns.set(key, analyzeContext(history));

      // Guard: abort, too short to meaningfully compact, or cooldown active.
      if (signal.aborted || history.length <= 5 || !tracker.canSummarize()) return;

      const config = getConfig();
      const softThreshold = config?.summarizationThreshold ?? 0.85;
      const minSaved = options.minSavedTokens ?? Math.max(200, Math.ceil(st.maxTokens * 0.03));
      const summarizationHandler = getSummarizationHandler?.(handler) ?? handler;

      const stages = buildStages(st.usageRatio, softThreshold, minSaved);
      if (stages.length === 0) return;

      for (const stage of stages) {
        if (signal.aborted) break;
        try {
          const { messages, savedTokens } = await summarizeHistory(history, {
            handler: summarizationHandler,
            signal,
            keepRecentMessages: stage.keepRecent,
            minSavedTokens: stage.minSaved,
          });
          if (savedTokens >= stage.minSaved) {
            tracker.recordCompaction();
            tracker.adjustAfterSummarization(savedTokens);
            const notice: CompactionNotice = {
              content: `_Context compressed — ${savedTokens.toLocaleString()} tokens freed._`,
            };
            return { history: messages, notices: [notice] };
          }
        } catch {
          // Summarisation is best-effort; fall through to the next stage.
        }
      }
    },
  };

  return toolSet;
}
