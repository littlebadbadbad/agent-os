import { describe, it, expect, vi } from 'vitest';
import { createTokenBudgetToolSet } from '../agent/tokenBudgetToolSet';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { SystemPromptContext, ToolSetContext } from '@agent-type';
import type { TokenBudgetConfig } from '../agent/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1', conversationId = MAIN_CONVERSATION_ID): ToolSetContext {
  return { sessionId, agentName: 'main', conversationId };
}

function makeSubCtx(sessionId = 'session-1', convId = 'conv-1'): ToolSetContext {
  return { sessionId, agentName: 'bot', conversationId: convId };
}

function makeConfig(maxTokens = 4096): () => TokenBudgetConfig {
  return () => ({ maxTokens, warningThreshold: 0.75, summarizationThreshold: 0.85 });
}

// ── createTokenBudgetToolSet ──────────────────────────────────────────────────

describe('createTokenBudgetToolSet', () => {
  // ── Shape ──────────────────────────────────────────────────────────────────

  it('returns a ToolSet with name "token-budget"', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    expect(ts.name).toBe('token-budget');
  });

  it('has no tools of its own', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    expect(ts.tools).toEqual([]);
  });

  // ── onInit ──────────────────────────────────────────────────────────

  it('onInit creates a tracker for main session', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx) as any;
    expect(state.type).toBe('tokenBudget');
    expect(state.tokenBudget).toBeDefined();
    expect(state.tokenBudget?.maxTokens).toBe(4096);
  });

  it('onInit creates a tracker for sub-agent conversations eagerly', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    // With unified onInit, sub-agent conversations also eagerly create a tracker.
    const state = ts.onGetSymbolState!(ctx) as any;
    expect(state.tokenBudget).toBeDefined();
    expect(state.tokenBudget?.maxTokens).toBe(4096);
  });

  it('onInit is a no-op when getConfig returns undefined', () => {
    const ts = createTokenBudgetToolSet(() => undefined);
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  // ── onRemove ────────────────────────────────────────────────────────

  it('onRemove deletes the tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    ts.onRemove!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onRemove does not affect other sessions', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onInit!(ctx1, { id: 's1', title: 'T' });
    ts.onInit!(ctx2, { id: 's2', title: 'T' });
    ts.onRemove!(ctx1);
    const state2 = ts.onGetSymbolState!(ctx2);
    expect(state2.tokenBudget).toBeDefined();
  });

  // ── onReset ─────────────────────────────────────────────────────────

  it('onReset replaces the tracker with a fresh one', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const before = ts.onGetSymbolState!(ctx);
    ts.onReset!(ctx);
    const after = ts.onGetSymbolState!(ctx);
    // The tracker should be fresh — turnCount back to 0.
    expect(after.tokenBudget?.turnCount).toBe(0);
    expect(before.tokenBudget?.maxTokens).toBe(after.tokenBudget?.maxTokens);
  });

  it('onReset is a no-op for sub-agent conversations', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx();
    expect(() => ts.onReset!(ctx)).not.toThrow();
  });

  // ── onInit / onRemove ──────────────────────────────

  it('onInit creates a tracker for sub-agent conversation', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInit!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeDefined();
  });

  it('onRemove deletes the sub-agent tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInit!(ctx);
    ts.onRemove!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onReset replaces the sub-agent tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInit!(ctx);
    ts.onReset!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget?.turnCount).toBe(0);
  });

  // ── onGetSymbolState ───────────────────────────────────────────────────────

  it('onGetSymbolState returns tokenBudget: undefined when no tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onGetSymbolState returns tokenBudget state after tracker created', () => {
    const ts = createTokenBudgetToolSet(makeConfig(8000));
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget!.maxTokens).toBe(8000);
    expect(state.tokenBudget!.turnCount).toBe(0);
    expect(state.tokenBudget!.usageRatio).toBe(0);
  });

  it('onGetSymbolState declares a headerBar slot', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.slots).toBeDefined();
    const headerBarSlot = state.slots!.find((s) => s.type === 'headerBar');
    expect(headerBarSlot).toBeDefined();
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires when tracker is removed', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const fn = vi.fn();
    ts.onSubscribe!(ctx, fn);
    ts.onRemove!(ctx);
    // notify() is called when tracker is deleted
    expect(fn).toHaveBeenCalled();
  });

  it('onSubscribe returns an unsubscribe function', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    unsub();
    ts.onRemove!(ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  it('onGetSystemPrompt returns undefined before any turns', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const prompt = ts.onGetSystemPrompt!(ctx, promptCtx, []);
    expect(prompt).toBeUndefined();
  });

  // ── onBuildSnapshot ────────────────────────────────────────────────────────

  it('onBuildSnapshot returns empty object (token budget is runtime-only)', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const snap = ts.onBuildSnapshot!(ctx);
    expect(snap).toEqual({});
  });

  // ── session isolation ──────────────────────────────────────────────────────

  it('different sessions have independent trackers', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onInit!(ctx1, { id: 's1', title: 'T' });
    ts.onInit!(ctx2, { id: 's2', title: 'T' });
    ts.onRemove!(ctx1);
    expect(ts.onGetSymbolState!(ctx1).tokenBudget).toBeUndefined();
    expect(ts.onGetSymbolState!(ctx2).tokenBudget).toBeDefined();
  });
});
