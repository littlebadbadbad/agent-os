/**
 * internal-apps/token-budget/agent/index.ts — Barrel exports for the Token Budget extension agent layer
 */

export { createTokenBudgetToolSet } from './tokenBudgetToolSet';
export { TOKEN_BUDGET_SYMBOL } from './tokenBudgetToolSet';
export { getTokenBudgetSlotDeclarations } from './tokenBudgetToolSet';
export { createTokenTracker } from './tokenTracker';
export { analyzeContext, buildContextHint } from './context';
export type { ContextBreakdown } from './context';
export { clearToolResults, buildStages } from './compaction';
export type { CompactResult, CompactionStage } from './compaction';
export {
  summarizeHistory,
  estimateTokens,
  SUMMARY_ANCHOR_PREFIX,
  SUMMARY_ANCHOR_ACK,
} from './summarize';
export type {
  TokenBudgetSymbolState,
  TokenBudgetToolSetOptions,
  TokenBudgetState,
  TokenBudgetConfig,
  TokenBudgetCallbacks,
  TokenTracker,
} from './types';
