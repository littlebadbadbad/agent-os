/**
 * Unit tests for historyTracker.ts — the dual-buffer history tracker shared
 * by the main agent and sub-agent execution paths.
 */

import { describe, it, expect } from 'vitest';
import { createHistoryTracker } from '../../tools/historyTracker';
import type { AgentMessage } from '@agent-type';

function msg(role: 'user' | 'assistant', content: string): AgentMessage {
  return { role, content };
}

describe('createHistoryTracker', () => {
  it('starts empty when no initial messages', () => {
    const t = createHistoryTracker();
    expect(t.getLiveHistory()).toEqual([]);
    expect(t.getFullHistory()).toEqual([]);
    expect(t.getTurnStart()).toBe(0);
  });

  it('initialises from initialMessages', () => {
    const initial = [msg('user', 'hello'), msg('assistant', 'hi')];
    const t = createHistoryTracker(initial);
    expect(t.getLiveHistory()).toHaveLength(2);
    expect(t.getFullHistory()).toHaveLength(2);
  });

  it('uses liveHistory when provided (separate from full)', () => {
    const initial = [msg('user', 'hello'), msg('assistant', 'full reply')];
    const live = [msg('user', 'hello'), msg('assistant', 'compacted reply')];
    const t = createHistoryTracker(initial, live);
    expect(t.getLiveHistory()[1].content).toBe('compacted reply');
    expect(t.getFullHistory()[1].content).toBe('full reply');
  });

  it('pushToBoth adds to both buffers', () => {
    const t = createHistoryTracker();
    t.pushToBoth(msg('user', 'test'));
    expect(t.getLiveHistory()).toHaveLength(1);
    expect(t.getFullHistory()).toHaveLength(1);
    expect(t.getLiveHistory()[0].content).toBe('test');
  });

  it('replaceBoth replaces both buffers', () => {
    const t = createHistoryTracker([msg('user', 'old')]);
    t.replaceBoth(
      [msg('user', 'new live')],
      [msg('user', 'new full')],
    );
    expect(t.getLiveHistory()[0].content).toBe('new live');
    expect(t.getFullHistory()[0].content).toBe('new full');
  });

  it('advanceTurn flushes turnStart boundary to full', () => {
    const t = createHistoryTracker([msg('user', 'first')]);
    // Simulate: user message was pushed, turnStart set to live.length
    t.setTurnStart(1);
    // Then the loop runs and returns [user, assistant]
    const loopResult = [msg('user', 'first'), msg('assistant', 'reply')];
    // advanceTurn pushes loopResult.slice(turnStart) = [assistant] to full
    t.advanceTurn(loopResult);
    // full = initial [user] + [assistant] from advanceTurn
    expect(t.getFullHistory()).toHaveLength(2);
    expect(t.getFullHistory()[1].content).toBe('reply');
    // turnStart resets to current live length
    expect(t.getTurnStart()).toBe(2);
  });

  it('advanceTurn with newLive replaces live and flushes', () => {
    const t = createHistoryTracker([msg('user', 'hello')]);
    t.setTurnStart(1);
    t.pushToBoth(msg('assistant', 'world'));
    const compacted = [msg('user', 'hello'), msg('user', 'compacted')];
    t.advanceTurn(compacted);
    expect(t.getLiveHistory()).toEqual(compacted);
    expect(t.getFullHistory()).toHaveLength(3); // original + turn content
    expect(t.getTurnStart()).toBe(compacted.length);
  });

  it('injectToFull adds to full only and advances turnStart', () => {
    const t = createHistoryTracker([msg('user', 'hello')]);
    const before = t.getTurnStart();
    t.injectToFull([msg('user', 'injected')]);
    expect(t.getFullHistory()).toHaveLength(2);
    // live should NOT contain the injected message
    expect(t.getLiveHistory()).toHaveLength(1);
    expect(t.getTurnStart()).toBe(before + 1);
  });

  it('reconcile fills gap when full is behind live', () => {
    const t = createHistoryTracker();
    t.pushToBoth(msg('user', 'a'));
    // Simulate a scenario where full fell behind
    t.replaceBoth(
      [msg('user', 'a'), msg('assistant', 'b')],
      [msg('user', 'a')],
    );
    t.reconcile();
    expect(t.getFullHistory()).toHaveLength(2);
    expect(t.getFullHistory()[1].content).toBe('b');
  });

  it('reconcile does nothing when full is already complete', () => {
    const t = createHistoryTracker([msg('user', 'a')]);
    t.reconcile();
    expect(t.getFullHistory()).toHaveLength(1);
  });

  it('reset clears both buffers', () => {
    const t = createHistoryTracker([msg('user', 'a')]);
    t.reset();
    expect(t.getLiveHistory()).toEqual([]);
    expect(t.getFullHistory()).toEqual([]);
    expect(t.getTurnStart()).toBe(0);
  });

  it('setTurnStart/getTurnStart round-trips correctly', () => {
    const t = createHistoryTracker([msg('user', 'a'), msg('user', 'b')]);
    t.setTurnStart(2);
    expect(t.getTurnStart()).toBe(2);
    t.setTurnStart(0);
    expect(t.getTurnStart()).toBe(0);
  });

  it('returns copies (not references) from getLiveHistory', () => {
    const t = createHistoryTracker([msg('user', 'a')]);
    const copy = t.getLiveHistory();
    copy.push(msg('user', 'b'));
    expect(t.getLiveHistory()).toHaveLength(1);
  });

  it('returns copies (not references) from getFullHistory', () => {
    const t = createHistoryTracker([msg('user', 'a')]);
    const copy = t.getFullHistory();
    copy.push(msg('user', 'b'));
    expect(t.getFullHistory()).toHaveLength(1);
  });
});
