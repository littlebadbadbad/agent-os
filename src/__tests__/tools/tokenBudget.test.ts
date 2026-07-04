import { describe, it, expect, vi } from 'vitest';
import { createTokenBudgetToolSet, MAIN_CONVERSATION_ID } from '@agent-sdk';
import type { SystemPromptContext } from '@agent-type';
import type { TokenBudgetConfig } from '@agent-sdk/tools/track/tokenTracker';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1', conversationId = MAIN_CONVERSATION_ID) {
  return { sessionId, agentName: 'main', conversationId };
}

function makeSubCtx(sessionId = 'session-1', convId = 'conv-1') {
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
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeDefined();
    expect((state as any).tokenBudget?.maxTokens).toBe(4096);
  });

  it('onInitSession is a no-op for sub-agent conversations', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    // Sub-agent trackers are created lazily, not by onInitSession.
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeUndefined();
  });

  it('onInitSession is a no-op when getConfig returns undefined', () => {
    const ts = createTokenBudgetToolSet(() => undefined);
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeUndefined();
  });

  // ── onRemoveSession ────────────────────────────────────────────────────────

  it('onRemoveSession deletes the tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    ts.onRemoveSession!(ctx);
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeUndefined();
  });

  it('onRemoveSession does not affect other sessions', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onInitSession!(ctx1, { id: 's1', title: 'T' });
    ts.onInitSession!(ctx2, { id: 's2', title: 'T' });
    ts.onRemoveSession!(ctx1);
    const state2 = ts.onGetState!(ctx2);
    expect((state2 as any).tokenBudget).toBeDefined();
  });

  // ── onResetSession ─────────────────────────────────────────────────────────

  it('onResetSession replaces the tracker with a fresh one', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const before = ts.onGetState!(ctx) as any;
    ts.onResetSession!(ctx);
    const after = ts.onGetState!(ctx) as any;
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
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeDefined();
  });

  it('onRemoveConversation deletes the sub-agent tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInitConversation!(ctx);
    ts.onRemoveConversation!(ctx);
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeUndefined();
  });

  it('onResetConversation replaces the sub-agent tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInitConversation!(ctx);
    ts.onResetConversation!(ctx);
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget?.turnCount).toBe(0);
  });

  // ── onGetState ─────────────────────────────────────────────────────────────

  it('onGetState returns tokenBudget: undefined when no tracker', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    const state = ts.onGetState!(ctx);
    expect((state as any).tokenBudget).toBeUndefined();
  });

  it('onGetState returns tokenBudget state after tracker created', () => {
    const ts = createTokenBudgetToolSet(makeConfig(8000));
    const ctx = makeCtx();
    ts.onInitSession!(ctx, { id: 'session-1', title: 'T' });
    const state = ts.onGetState!(ctx) as any;
    expect(state.tokenBudget.maxTokens).toBe(8000);
    expect(state.tokenBudget.turnCount).toBe(0);
    expect(state.tokenBudget.usageRatio).toBe(0);
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
    const prompt = ts.onGetSystemPrompt!(ctx, { userMessage: undefined, baseSystemPrompt: undefined, currentSystemPromptParts: [], suppressToolSetPrompt: () => {} }, []);
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
    expect((ts.onGetState!(ctx1) as any).tokenBudget).toBeUndefined();
    expect((ts.onGetState!(ctx2) as any).tokenBudget).toBeDefined();
  });
});
