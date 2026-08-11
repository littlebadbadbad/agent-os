import { describe, it, expect, vi } from 'vitest';
import { createTokenBudgetToolSet, getTokenBudgetSlotDeclarations } from '../agent/tokenBudgetToolSet';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import { CLEARED_TOOL_RESULT } from '../agent/summarize/constants';
import type { AgentHandler, AgentMessage, AgentStreamChunk, SystemPromptContext, ToolSetContext, TokenUsage } from '@agent-type';
import type { TokenBudgetConfig, TokenBudgetState } from '../agent/types';

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

function budgetState(usageRatio: number): TokenBudgetState {
  return {
    maxTokens: 4096,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    lastPromptTokens: 0,
    usageRatio,
    turnCount: 1,
    warning: false,
    shouldSummarize: false,
    sinceLastCompaction: Infinity,
  };
}

function userMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function assistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function toolMsg(name: string, content: string): AgentMessage {
  return { role: 'tool', toolCallId: `tc-${name}`, name, content };
}

function mockHandler(impl: AgentHandler): ReturnType<typeof vi.fn<AgentHandler>> {
  return vi.fn<AgentHandler>(impl);
}

/** A usage record that pushes the tracker past the summarization threshold. */
function hotUsage(): TokenUsage {
  return { promptTokens: 3500, completionTokens: 100, totalTokens: 3600 };
}

/** History with large tool results — triggers the tool-result clearing stage. */
function buildToolHeavyHistory(): AgentMessage[] {
  return [
    userMsg('Q1'), assistantMsg('A1'), toolMsg('read', 'x'.repeat(2000)),
    userMsg('Q2'), assistantMsg('A2'), toolMsg('search', 'y'.repeat(2000)),
    userMsg('Q3'), assistantMsg('A3'), toolMsg('read', 'z'.repeat(2000)),
    userMsg('Q4'), assistantMsg('A4'),
  ];
}

/** History with long assistant turns but no tool results — forces summarization. */
function buildVerboseHistory(): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < 6; i++) {
    msgs.push(userMsg(`Question ${i}`));
    msgs.push(assistantMsg(`Answer ${i} ` + 'v'.repeat(400)));
  }
  return msgs;
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
    const state = ts.onGetSymbolState!(ctx);
    expect(state.tokenBudget).toBeDefined();
    expect(state.tokenBudget?.maxTokens).toBe(4096);
  });

  it('onInit creates a tracker for sub-agent conversations eagerly', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    // With unified onInit, sub-agent conversations also eagerly create a tracker.
    const state = ts.onGetSymbolState!(ctx);
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

  it('getTokenBudgetSlotDeclarations declares a headerBar slot', () => {
    const slots = getTokenBudgetSlotDeclarations();
    expect(slots).toHaveLength(1);
    expect(slots[0].type).toBe('headerBar');
  });

  it('headerBar slot render gate reflects token-budget usage', () => {
    const headerBar = getTokenBudgetSlotDeclarations().find((s) => s.type === 'headerBar');
    expect(headerBar).toBeDefined();
    if (!headerBar?.shouldRender) return;
    const ctx = makeCtx();
    // No state → gate is false.
    expect(headerBar.shouldRender(ctx, undefined)).toBe(false);
    // No budget slice → gate is false.
    expect(headerBar.shouldRender(ctx, {})).toBe(false);
    // Zero usage → gate is false.
    expect(headerBar.shouldRender(ctx, { tokenBudget: budgetState(0) })).toBe(false);
    // Recorded usage → gate is true.
    expect(headerBar.shouldRender(ctx, { tokenBudget: budgetState(0.5) })).toBe(true);
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

  // ── onAfterTurn ──────────────────────────────────────────────────────

  it('onAfterTurn returns early when no config is available', async () => {
    const ts = createTokenBudgetToolSet(() => undefined);
    const ctx = makeCtx();
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAfterTurn returns early when usage is undefined', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), undefined, new AbortController().signal, handler);
    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAfterTurn records usage and caches a breakdown', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    // Cold usage: below the summarization threshold, so no compaction attempt.
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), { promptTokens: 100, completionTokens: 50, totalTokens: 150 }, new AbortController().signal, handler);
    expect(result).toBeUndefined();
    const state = ts.onGetSymbolState!(ctx).tokenBudget;
    expect(state?.turnCount).toBe(1);
  });

  it('onAfterTurn skips compaction when the signal is already aborted', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const controller = new AbortController();
    controller.abort();
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), controller.signal, handler);
    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAfterTurn skips compaction when history is too short', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const shortHistory = [userMsg('Q'), assistantMsg('A'), userMsg('Q2')];
    const result = await ts.onAfterTurn!(ctx, shortHistory, hotUsage(), new AbortController().signal, handler);
    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('onAfterTurn skips compaction during the cooldown period', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    // First compaction succeeds via tool-result clearing…
    const first = await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), new AbortController().signal, handler);
    expect(first).toBeDefined();
    // …then the immediate next turn is inside the cooldown window.
    const second = await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), new AbortController().signal, handler);
    expect(second).toBeUndefined();
  });

  it('onAfterTurn clears tool results first (zero LLM round-trips)', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const result = await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeDefined();
    expect(result?.notices).toHaveLength(1);
    if (result?.notices) {
      expect(result.notices[0].content).toContain('tokens freed');
    }
    // Tool results were replaced, not summarized — the LLM was never called.
    expect(handler).not.toHaveBeenCalled();
    const cleared = result?.history.filter((m) => m.role === 'tool') ?? [];
    // Old tool results (before the recent window) are replaced with the placeholder.
    expect(cleared.filter((m) => m.content === CLEARED_TOOL_RESULT).length).toBeGreaterThan(0);
    // The most recent tool result travels with its assistant turn and stays verbatim.
    expect(cleared.some((m) => m.content === 'z'.repeat(2000))).toBe(true);
  });

  it('onAfterTurn falls through to summarization when clearing saves too little', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'Short.' }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeDefined();
    expect(result?.history[0].content).toContain('[Context summary]');
    expect(handler).toHaveBeenCalled();
  });

  it('onAfterTurn skips tool-result clearing when disabled', async () => {
    const ts = createTokenBudgetToolSet(makeConfig(), { enableToolResultClearing: false });
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'Short.' }));
    const result = await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), new AbortController().signal, handler);
    // Clearing disabled → summarization runs instead, so the handler is called.
    expect(handler).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('onAfterTurn uses a custom summarization handler when provided', async () => {
    const cheap = mockHandler(async () => ({ text: 'Cheap.' }));
    const ts = createTokenBudgetToolSet(makeConfig(), {
      getSummarizationHandler: () => cheap,
    });
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const main = mockHandler(async () => ({ text: 'Main.' }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), new AbortController().signal, main);
    expect(result).toBeDefined();
    expect(cheap).toHaveBeenCalled();
    expect(main).not.toHaveBeenCalled();
  });

  it('onAfterTurn returns undefined when every stage fails to save enough', async () => {
    // The verbose history is large, but the handler always returns a summary
    // as long as the source → compressionCheck rejects it at every stage.
    const longSummary = 'w'.repeat(6000);
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: longSummary }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeUndefined();
  });

  it('honors custom hard/emergency compaction thresholds', async () => {
    const ts = createTokenBudgetToolSet(makeConfig(), {
      hardCompactionThreshold: 0.4,
      emergencyThreshold: 0.5,
    });
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'Short.' }));
    // usageRatio 0.854 crosses all three stages (soft 0.85 / hard 0.4 / emergency 0.5).
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeDefined();
    expect(handler).toHaveBeenCalled();
  });

  it('falls back to the default soft threshold when config omits it', async () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'Short.' }));
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeDefined();
    expect(handler).toHaveBeenCalled();
  });

  it('onSubscribe supports multiple subscribers for the same scope', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    ts.onSubscribe!(ctx, fn1);
    ts.onSubscribe!(ctx, fn2); // second subscription reuses the existing set
    ts.onRemove!(ctx);
    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it('aborts the stage loop when the signal fires mid-compaction', async () => {
    const controller = new AbortController();
    const ts = createTokenBudgetToolSet(makeConfig(), {
      hardCompactionThreshold: 0.4,
      emergencyThreshold: 0.5,
    });
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    let firstCall = true;
    const handler = mockHandler(async () => {
      if (firstCall) {
        firstCall = false;
        const chunks: AgentStreamChunk[] = [{ type: 'text', delta: 'partial' }];
        let idx = 0;
        return new ReadableStream<AgentStreamChunk>({
          pull(c) {
            if (idx < chunks.length) {
              c.enqueue(chunks[idx]);
              idx += 1;
            } else {
              controller.abort();
              c.close();
            }
          },
        });
      }
      return { text: 'S.' };
    });
    const result = await ts.onAfterTurn!(ctx, buildVerboseHistory(), hotUsage(), controller.signal, handler);
    expect(result).toBeUndefined();
  });

  it('onAfterTurn compacts a sub-agent conversation independently', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeSubCtx('session-1', 'conv-A');
    ts.onInit!(ctx);
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const result = await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), new AbortController().signal, handler);
    expect(result).toBeDefined();
  });

  // ── onGetSystemPrompt pressure hints ──────────────────────────────────

  it('onGetSystemPrompt returns undefined when no tracker exists', () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const hint = ts.onGetSystemPrompt!(makeCtx(), promptCtx, []);
    expect(hint).toBeUndefined();
  });

  it('onGetSystemPrompt uses the default soft threshold when config omits it', async () => {
    const ts = createTokenBudgetToolSet(() => ({ maxTokens: 4096 }));
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    const controller = new AbortController();
    controller.abort();
    await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), controller.signal, handler);
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const hint = ts.onGetSystemPrompt!(ctx, promptCtx, []);
    expect(hint).toBeDefined();
  });

  it('onGetSystemPrompt uses a breakdown-aware hint above the soft threshold', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const handler = mockHandler(async () => ({ text: 'S.' }));
    // Record a hot usage but abort before compaction: the pressure stays high
    // while the breakdown is cached for the prompt hint.
    const controller = new AbortController();
    controller.abort();
    await ts.onAfterTurn!(ctx, buildToolHeavyHistory(), hotUsage(), controller.signal, handler);
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const hint = ts.onGetSystemPrompt!(ctx, promptCtx, []);
    expect(hint).toBeDefined();
    expect(hint).toContain('Context window');
    expect(hint).toContain('tool results:');
  });

  it('onGetSystemPrompt falls back to a generic hint without a breakdown', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    // Force the tracker past the soft threshold without caching a breakdown:
    // onAfterTurn is never called, so the breakdown map stays empty.
    const tracker = ts.onGetSymbolState!(ctx).tokenBudget;
    expect(tracker).toBeDefined();
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const hint = ts.onGetSystemPrompt!(ctx, promptCtx, []);
    expect(hint).toBeUndefined(); // turnCount is still 0 — no hint yet
  });

  it('onGetSystemPrompt emits a concise warning between warning and soft thresholds', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    // usageRatio = 3000/4096 ≈ 0.73 < 0.75 warning? Use 3100 → 0.757 → warning,
    // still below 0.85 soft threshold.
    const usage: TokenUsage = { promptTokens: 3100, completionTokens: 100, totalTokens: 3200 };
    const handler = mockHandler(async () => ({ text: 'S.' }));
    await ts.onAfterTurn!(ctx, buildVerboseHistory(), usage, new AbortController().signal, handler);
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const hint = ts.onGetSystemPrompt!(ctx, promptCtx, []);
    expect(hint).toContain('keep responses concise');
  });

  it('onGetSystemPrompt returns undefined below the warning threshold', async () => {
    const ts = createTokenBudgetToolSet(makeConfig());
    const ctx = makeCtx();
    ts.onInit!(ctx, { id: 'session-1', title: 'T' });
    const usage: TokenUsage = { promptTokens: 500, completionTokens: 50, totalTokens: 550 };
    const handler = mockHandler(async () => ({ text: 'S.' }));
    await ts.onAfterTurn!(ctx, buildVerboseHistory(), usage, new AbortController().signal, handler);
    const promptCtx: SystemPromptContext = {
      userMessage: undefined,
      baseSystemPrompt: undefined,
      currentSystemPromptParts: [],
      suppressToolSetPrompt: () => {},
    };
    const hint = ts.onGetSystemPrompt!(ctx, promptCtx, []);
    expect(hint).toBeUndefined();
  });
});
