/**
 * extensions/token-budget/agent/types.ts — Type definitions for the Token Budget extension
 *
 * Moved from src/tools/track/tokenTracker.ts (type exports) and
 * src/tools/track/tokenBudgetToolSet.ts (options type).
 *
 * Defines the symbol state interface that extends PluginUiAdapter,
 * enabling isolated state injection via `onGetSymbolState`.
 */

import type { PluginStateExtension, PluginUiAdapter } from '@agent-type';
import type {
  TokenBudgetState,
  TokenBudgetConfig,
  TokenBudgetCallbacks,
  TokenTracker,
} from './tokenTracker';

// Re-export core types so consumers can import everything from one place
export type {
  TokenBudgetState,
  TokenBudgetConfig,
  TokenBudgetCallbacks,
  TokenTracker,
};

// ── Symbol state interface ────────────────────────────────────────────────────

/**
 * The state slice returned by the token-budget ToolSet's `onGetSymbolState`.
 *
 * Stored under `state[TOKEN_BUDGET_SYMBOL]` in the session state, isolating
 * token budget state from the root `AgentSessionState`.
 *
 * The `slots` array declares a `headerBar` slot that renders the token
 * progress bar in the host UI.
 */
export interface TokenBudgetSymbolState extends PluginStateExtension, PluginUiAdapter {
  readonly type: 'tokenBudget';
  /** Current token budget state (undefined when no tracker is active). */
  readonly tokenBudget: TokenBudgetState | undefined;
}

// ── Module augmentation — direct field access in UI ──────────────────────────
// Single-ToolSet plugins augment PluginStateExtension so the iframe UI
// can access fields without casts: state?.tokenBudget, state?.todos, etc.

declare module "@agent-type" {
  interface PluginStateExtension {
    readonly tokenBudget?: TokenBudgetState | undefined;
  }
}

// ── ToolSet options ───────────────────────────────────────────────────────────

/**
 * Additional options for the token-budget ToolSet, separate from the per-session
 * `TokenBudgetConfig` returned by `getConfig`.
 */
export type TokenBudgetToolSetOptions = {
  /**
   * Context-window usage ratio that triggers "hard" compaction (keepRecent=2).
   * Must be strictly greater than `summarizationThreshold` (soft stage).
   * Defaults to `0.92`.
   */
  hardCompactionThreshold?: number;
  /**
   * Context-window usage ratio that triggers "emergency" compaction (keepRecent=1).
   * Must be strictly greater than `hardCompactionThreshold`.
   * Defaults to `0.97`.
   */
  emergencyThreshold?: number;
  /**
   * Minimum estimated token savings required for a compaction stage to be
   * considered successful.  If the estimated saving is below this value the
   * stage is skipped and the next (more aggressive) stage is attempted.
   *
   * Defaults to `Math.max(200, maxTokens * 0.03)` per session (computed lazily
   * when the first tracker is built).  Pass an explicit value to override.
   */
  minSavedTokens?: number;
  /**
   * Optional factory that wraps or replaces the main conversation handler with
   * a cheaper/faster handler specifically for summarization calls.
   *
   * @example
   * ```ts
   * getSummarizationHandler: (base) => cheapModelHandler,
   * ```
   */
  getSummarizationHandler?: (baseHandler: import('@agent-type').AgentHandler) => import('@agent-type').AgentHandler;
};
