/**
 * Shared ToolSet state collector.
 *
 * Unifies the duplicated `onGetState` + `onGetSymbolState` iteration pattern
 * between the main agent (`sessionFactory.ts`) and sub-agent
 * (`registrySnapshot.ts`).  Both callers now delegate here.
 */

import type { ToolSet, ToolSetContext, ToolSetStateContext, AppStateExtension } from '@agent-type';

// ── Results ───────────────────────────────────────────────────────────────────

export type CollectedStates = {
  /** Merged `onGetState` results from every ToolSet. */
  readonly plain: Record<string, unknown>;
  /** Merged `onGetSymbolState` results, keyed by each ToolSet's `symbol`. */
  readonly symbol: Record<symbol, AppStateExtension>;
};

// ── Collector ─────────────────────────────────────────────────────────────────

/**
 * Iterate all ToolSets and collect their `onGetState` and `onGetSymbolState`
 * contributions into a single result object.
 *
 * Array-valued `onGetState` fields are concatenated rather than overwritten.
 * Symbol-keyed state is merged via `Object.assign` (previous symbol state is
 * spread first, then the current ToolSet's contribution is applied on top).
 */
export function collectAllToolSetStates(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  stateCtx: ToolSetStateContext,
  existing?: Record<string, unknown>,
): CollectedStates {
  const plain: Record<string, unknown> = existing ? { ...existing } : {};
  const symbol: Record<symbol, AppStateExtension> = {};

  for (const ts of toolSets) {
    // ── onGetState ────────────────────────────────────────────────────────
    if (ts.onGetState) {
      const state = ts.onGetState(ctx, stateCtx);
      if (state) {
        for (const [k, v] of Object.entries(state)) {
          plain[k] =
            Array.isArray(v) && Array.isArray(plain[k])
              ? [...(plain[k] as unknown[]), ...v]
              : v;
        }
      }
    }

    // ── onGetSymbolState ──────────────────────────────────────────────────
    if (ts.symbol && ts.onGetSymbolState) {
      const state = ts.onGetSymbolState(ctx, stateCtx);
      if (state) {
        const existingSymbol = symbol[ts.symbol];
        const merged = Object.assign(
          {},
          existingSymbol ?? {},
          state,
        );
        symbol[ts.symbol] = merged;
        // Flatten symbol-state fields into the plain record so that
        // string-keyed access (e.g. `state.variables`) continues to work
        // after ToolSets migrate from `onGetState` to `onGetSymbolState`.
        for (const [k, v] of Object.entries(merged)) {
          plain[k] =
            Array.isArray(v) && Array.isArray(plain[k])
              ? [...(plain[k] as unknown[]), ...v]
              : v;
        }
      }
    }
  }

  return { plain, symbol };
}

/**
 * Same as `collectAllToolSetStates` but returns the result as a single merged
 * record suitable for `Partial<AgentSessionState>` — both plain string-keyed
 * fields AND symbol-keyed app state slices are mixed into one object.
 *
 * This is the shape the original inline code in `sessionFactory.ts` produced:
 * the symbol state must be on the same object because `AgentSessionExtension`
 * has a `[key: ToolSetSymbol]` index signature that slot-renderer / app
 * discovery code reads from.
 */
export function mergeAllToolSetStates(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  stateCtx: ToolSetStateContext,
): Record<string | symbol, unknown> {
  const { plain, symbol } = collectAllToolSetStates(toolSets, ctx, stateCtx);
  const merged: Record<string | symbol, unknown> = { ...plain };
  // Copy symbol-keyed entries — Object.entries skips them,
  // so we use getOwnPropertySymbols + direct assignment.
  const symKeys = Object.getOwnPropertySymbols(symbol);
  for (const sym of symKeys) {
    merged[sym] = symbol[sym as keyof typeof symbol];
  }
  return merged;
}

// ── Snapshot collector ────────────────────────────────────────────────────────

/**
 * Iterate all ToolSets and collect their `onBuildSnapshot` contributions.
 */
export function collectSnapshotData(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const ts of toolSets) {
    const s = ts.onBuildSnapshot?.(ctx);
    if (s) Object.assign(merged, s);
  }
  return merged;
}
