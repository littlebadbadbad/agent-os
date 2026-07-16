/**
 * Tests for the shared ToolSet state collector.
 *
 * Verifies that `collectAllToolSetStates` correctly merges `onGetState` and
 * `onGetSymbolState` results from multiple ToolSets, and that
 * `collectSnapshotData` aggregates `onBuildSnapshot` contributions.
 */

import { describe, it, expect } from 'vitest';
import { collectAllToolSetStates, collectSnapshotData, mergeAllToolSetStates } from '../../tools/sharedStateCollector';
import type { ToolSet, ToolSetContext, ToolSetStateContext, PluginStateExtension, PluginUiAdapter } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_CTX: ToolSetContext = {
  sessionId: 'test-session',
  agentName: 'test-agent',
  conversationId: 'test-conv',
};

function makeStateCtx(tools?: any[]): ToolSetStateContext {
  return { tools: (tools ?? []) as any, prevState: undefined };
}

// Accept loose overrides so callback-lambda signatures don't fight
// ToolSet's strict `(ctx, stateCtx?) => PluginStateExtension` type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeToolSet(name: string, overrides?: Record<string, any>): ToolSet {
  return { name, tools: [], ...overrides } as ToolSet;
}

// ── collectAllToolSetStates ───────────────────────────────────────────────────

describe('collectAllToolSetStates', () => {
  it('returns empty plain and symbol when no ToolSets contribute', () => {
    const ts = makeToolSet('empty');
    const result = collectAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.plain).toEqual({});
    expect(result.symbol).toEqual({});
  });

  it('collects onGetState plain fields from ToolSets', () => {
    const ts = makeToolSet('a', {
      onGetState: () => ({ count: 42, label: 'hello' }),
    });
    const result = collectAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.plain).toEqual({ count: 42, label: 'hello' });
  });

  it('merges plain fields from multiple ToolSets', () => {
    const tsA = makeToolSet('a', { onGetState: () => ({ count: 42 }) });
    const tsB = makeToolSet('b', { onGetState: () => ({ label: 'world' }) });
    const result = collectAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    expect(result.plain).toEqual({ count: 42, label: 'world' });
  });

  it('later ToolSet overrides earlier plain fields with same key', () => {
    const tsA = makeToolSet('a', { onGetState: () => ({ value: 1 }) });
    const tsB = makeToolSet('b', { onGetState: () => ({ value: 2 }) });
    const result = collectAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    expect(result.plain).toEqual({ value: 2 });
  });

  it('concatenates array-valued plain fields', () => {
    const tsA = makeToolSet('a', { onGetState: () => ({ items: ['a'] }) });
    const tsB = makeToolSet('b', { onGetState: () => ({ items: ['b', 'c'] }) });
    const result = collectAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    expect(result.plain).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('collects onGetSymbolState when ToolSet has a symbol', () => {
    const sym = Symbol('test');
    const ts = makeToolSet('a', {
      symbol: sym,
      onGetSymbolState: () => ({ data: 'plugin-data' }),
    });
    const result = collectAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.symbol[sym]).toEqual({ data: 'plugin-data' });
  });

  it('merges symbol state from multiple ToolSets', () => {
    const symA = Symbol('a');
    const symB = Symbol('b');
    const tsA = makeToolSet('a', {
      symbol: symA,
      onGetSymbolState: () => ({ value: 'from-a' }),
    });
    const tsB = makeToolSet('b', {
      symbol: symB,
      onGetSymbolState: () => ({ value: 'from-b' }),
    });
    const result = collectAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    expect(result.symbol[symA]).toEqual({ value: 'from-a' });
    expect(result.symbol[symB]).toEqual({ value: 'from-b' });
  });

  it('merges symbol state with ToolSet ordering (later wins on conflicts)', () => {
    const sym = Symbol('shared');
    const tsA = makeToolSet('a', {
      symbol: sym,
      onGetSymbolState: () => ({ base: 'from-a', override: 'first' }),
    });
    const tsB = makeToolSet('b', {
      symbol: sym,
      onGetSymbolState: () => ({ override: 'second' }),
    });
    const result = collectAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    expect(result.symbol[sym]).toEqual({ base: 'from-a', override: 'second' });
  });

  it('skips ToolSet without symbol when collecting symbol state', () => {
    const ts = makeToolSet('a'); // no symbol, no onGetSymbolState
    const result = collectAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.symbol).toEqual({});
  });

  it('skips ToolSet with symbol but no onGetSymbolState', () => {
    const ts = makeToolSet('a', { symbol: Symbol('no-fn') });
    const result = collectAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.symbol).toEqual({});
  });

  it('uses existing array content from the ToolSetStateContext prevState', () => {
    const ts = makeToolSet('a', { onGetState: () => ({ items: ['c'] }) });
    const stateCtx: ToolSetStateContext = { tools: [], prevState: { items: ['a', 'b'] } as any };
    const result = collectAllToolSetStates([ts], EMPTY_CTX, stateCtx, { items: ['a', 'b'] });
    expect(result.plain).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('returns plain and symbol concurrently', () => {
    const sym = Symbol('plugin');
    const ts = makeToolSet('a', {
      onGetState: () => ({ visible: true }),
      symbol: sym,
      onGetSymbolState: () => ({ hidden: 'data' }),
    });
    const result = collectAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.plain).toEqual({ visible: true });
    expect(result.symbol[sym]).toEqual({ hidden: 'data' });
  });
});

// ── mergeAllToolSetStates ────────────────────────────────────────────────────
//
// This function exists because `sessionFactory.ts`'s `getExternalState` must
// return a single `Partial<AgentSessionState>` with BOTH plain fields and
// symbol-keyed plugin state on the same object — slot renderers and plugin
// discovery code read state via `state[symbol]`.
//
// The original refactor split them into `{ plain, symbol }`, causing all
// plugin UI (tabs, toolbars, slots) to silently disappear.  These tests
// prevent that regression.

describe('mergeAllToolSetStates', () => {
  it('merges plain and symbol fields into one record', () => {
    const sym = Symbol('test-plugin');
    const ts = makeToolSet('a', {
      onGetState: () => ({ visible: true, count: 42 }),
      symbol: sym,
      onGetSymbolState: () => ({ data: 'plugin-data' }),
    });
    const result = mergeAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    // Plain fields accessible
    expect(result.visible).toBe(true);
    expect(result.count).toBe(42);
    // Symbol-keyed plugin state accessible
    expect(result[sym]).toEqual({ data: 'plugin-data' });
  });

  it('preserves symbol state from multiple ToolSets', () => {
    const symA = Symbol('plugin-a');
    const symB = Symbol('plugin-b');
    const tsA = makeToolSet('a', {
      onGetState: () => ({ fieldA: 'a' }),
      symbol: symA,
      onGetSymbolState: () => ({ slots: [] }),
    });
    const tsB = makeToolSet('b', {
      onGetState: () => ({ fieldB: 'b' }),
      symbol: symB,
      onGetSymbolState: () => ({ slots: [] }),
    });
    const result = mergeAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    // Both plain fields
    expect(result.fieldA).toBe('a');
    expect(result.fieldB).toBe('b');
    // Both symbol states accessible
    expect(result[symA]).toEqual({ slots: [] });
    expect(result[symB]).toEqual({ slots: [] });
  });

  it('plain fields merged when ToolSet contributes both', () => {
    const sym = Symbol('hybrid');
    const ts = makeToolSet('a', {
      onGetState: () => ({ hybridField: 'present' }),
      symbol: sym,
      onGetSymbolState: () => ({ hidden: true }),
    });
    const result = mergeAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.hybridField).toBe('present');
    expect(result[sym]).toEqual({ hidden: true });
  });

  it('returns empty record when no ToolSets contribute', () => {
    const ts = makeToolSet('empty');
    const result = mergeAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(Object.keys(result).length).toBe(0);
    expect(Object.getOwnPropertySymbols(result).length).toBe(0);
  });

  it('skips ToolSets without symbol', () => {
    const ts = makeToolSet('a', {
      onGetState: () => ({ plainOnly: true }),
      // no symbol
    });
    const result = mergeAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    expect(result.plainOnly).toBe(true);
    expect(Object.getOwnPropertySymbols(result).length).toBe(0);
  });

  it('merges symbol state only when ToolSet has both symbol and onGetSymbolState', () => {
    const sym = Symbol('has-fn');
    const noFnSym = Symbol('no-fn');
    const tsA = makeToolSet('a', {
      symbol: sym,
      onGetSymbolState: () => ({ active: true }),
    });
    const tsB = makeToolSet('b', {
      symbol: noFnSym,
      // no onGetSymbolState
    });
    const result = mergeAllToolSetStates([tsA, tsB], EMPTY_CTX, makeStateCtx());
    expect(result[sym]).toEqual({ active: true });
    expect(result[noFnSym]).toBeUndefined();
  });

  it('matches the exact shape returned by sessionFactory.getExternalState', () => {
    // This mirrors the production contract: the merged object is spread into
    // AgentSessionState via getExternalState().  Plugins read symbol state
    // through AgentSessionExtension's `[key: ToolSetSymbol]` index signature.
    const sym = Symbol('mock-plugin');
    const ts = makeToolSet('mock', {
      onGetState: () => ({ subAgentRegistry: null, toolStates: [] }),
      symbol: sym,
      onGetSymbolState: () => ({ slots: [] }),
    });
    const merged = mergeAllToolSetStates([ts], EMPTY_CTX, makeStateCtx());
    // Simulate what sessionFactory does:
    const state: Record<string | symbol, unknown> = { id: 'sess-1', messages: [], isLoading: false, ...merged };
    // Symbol state must be accessible — this is what slot renderers do
    const pluginState = state[sym];
    expect(pluginState).toBeDefined();
    expect(pluginState).toEqual({ slots: [] });
  });
});

// ── collectSnapshotData ───────────────────────────────────────────────────────

describe('collectSnapshotData', () => {
  it('returns empty when no ToolSets contribute', () => {
    const ts = makeToolSet('empty');
    expect(collectSnapshotData([ts], EMPTY_CTX)).toEqual({});
  });

  it('collects onBuildSnapshot from one ToolSet', () => {
    const ts = makeToolSet('a', {
      onBuildSnapshot: (_ctx: ToolSetContext) => ({ persistedKey: 'value' }),
    });
    expect(collectSnapshotData([ts], EMPTY_CTX)).toEqual({ persistedKey: 'value' });
  });

  it('merges onBuildSnapshot from multiple ToolSets', () => {
    const tsA = makeToolSet('a', { onBuildSnapshot: (_ctx: ToolSetContext) => ({ keyA: 'valA' }) });
    const tsB = makeToolSet('b', { onBuildSnapshot: (_ctx: ToolSetContext) => ({ keyB: 'valB' }) });
    expect(collectSnapshotData([tsA, tsB], EMPTY_CTX)).toEqual({ keyA: 'valA', keyB: 'valB' });
  });

  it('later ToolSets override earlier ones', () => {
    const tsA = makeToolSet('a', { onBuildSnapshot: (_ctx: ToolSetContext) => ({ key: 'first' }) });
    const tsB = makeToolSet('b', { onBuildSnapshot: (_ctx: ToolSetContext) => ({ key: 'second' }) });
    expect(collectSnapshotData([tsA, tsB], EMPTY_CTX)).toEqual({ key: 'second' });
  });
});
