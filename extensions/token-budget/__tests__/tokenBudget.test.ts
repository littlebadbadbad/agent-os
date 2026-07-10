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

  // ── onInitSession ──────────────────────────────────────────────────────────

  it('onInitSession creates a tracker for main session', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.type).toBe('tokenBudget');
    expect(state.tokenBudget).toBeDefined();
    expect(state.tokenBudget?.maxTokens).toBe(4096);
  });

  it('onInitSession is a no-op for sub-agent conversations', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    // Sub-agent trackers are created lazily, not by onInitSession.
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onInitSession is a no-op when getConfig returns undefined', () => {
    const ts = createTokenBudgetToolSet(() => undefined);
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  // ── onRemoveSession ────────────────────────────────────────────────────────

  it('onRemoveSession deletes the tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    ts.onRemoveSession!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onRemoveSession does not affect other sessions', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onInitSession!(ctx1, { id: 's1', title: 'T' });
    ts.onInitSession!(ctx2, { id: 's2', title: 'T' });
    ts.onRemoveSession!(ctx1);
    const state2 = ts.onGetSymbolState!(ctx2);
    expect(state2.tokenBudget).toBeDefined();
  });

  // ── onResetSession ─────────────────────────────────────────────────────────

  it('onResetSession replaces the tracker with a fresh one', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const before = ts.onGetSymbolState!(ctx);
    ts.onResetSession!(ctx);
    const after = ts.onGetSymbolState!(ctx);
    // The tracker should be fresh — turnCount back to 0.
    expect(after.tokenBudget?.turnCount).toBe(0);
    expect(before.tokenBudget?.maxTokens).toBe(after.tokenBudget?.maxTokens);
  });

  it('onResetSession is a no-op for sub-agent conversations', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx();
    expect(() => ts.onResetSession!(ctx)).not.toThrow();
  });

  // ── onInitConversation / onRemoveConversation ──────────────────────────────

  it('onInitConversation creates a tracker for sub-agent conversation', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInitConversation!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeDefined();
  });

  it('onRemoveConversation deletes the sub-agent tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInitConversation!(ctx);
    ts.onRemoveConversation!(ctx);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeUndefined();
  });

  it('onResetConversation replaces the sub-agent tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInitConversation!(ctx);
    ts.onResetConversation!(ctx);
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
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget!.maxTokens).toBe(8000);
    expect(state.tokenBudget!.turnCount).toBe(0);
    expect(state.tokenBudget!.usageRatio).toBe(0);
  });

  it('onGetSymbolState declares a headerBar slot', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetSymbolState!(ctx);
    expect(state.slots).toBeDefined();
    const headerBarSlot = state.slots!.find((s) => s.type === 'headerBar');
    expect(headerBarSlot).toBeDefined();
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires when tracker is removed', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const fn = vi.fn();
    ts.onSubscribe!(ctx, fn);
    ts.onRemoveSession!(ctx);
    // notify() is called when tracker is deleted
    expect(fn).toHaveBeenCalled();
  });

  it('onSubscribe returns an unsubscribe function', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    unsub();
    ts.onRemoveSession!(ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  it('onGetSystemPrompt returns undefined before any turns', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
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
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const snap = ts.onBuildSnapshot!(ctx);
    expect(snap).toEqual({});
  });

  // ── session isolation ──────────────────────────────────────────────────────

  it('different sessions have independent trackers', () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onInitSession!(ctx1, { id: 's1', title: 'T' });
    ts.onInitSession!(ctx2, { id: 's2', title: 'T' });
    ts.onRemoveSession!(ctx1);
    expect(ts.onGetSymbolState!(ctx1).tokenBudget).toBeUndefined();
    expect(ts.onGetSymbolState!(ctx2).tokenBudget).toBeDefined();
  });
});
