/**
 * Unit tests for historyTracker.ts — the dual-buffer history tracker shared
 * by the main agent and sub-agent execution paths.
 */
// @ts-nocheck
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

// ── Helper for tool call / tool result tests ──────────────────────────────────

function toolCallMsg(id: string, name: string, content = ''): AgentMessage {
  return { role: 'assistant', content, toolCalls: [{ id, name, arguments: {} }] };
}

function toolResultMsg(id: string, name: string, result: unknown = 'done'): AgentMessage {
  return { role: 'tool', toolCallId: id, name, content: result };
}

// ── sealOrphanedToolCalls ─────────────────────────────────────────────────────

describe('sealOrphanedToolCalls', () => {
  // ── On create (automatic seal) ──────────────────────────────────────────────

  it('seals orphaned tool calls on create from initialMessages', () => {
    const history = [
      msg('user', 'create an agent'),
      toolCallMsg('call-1', 'create_stream_subagent'),
      // NOTE: no matching tool result for call-1 — orphaned!
    ];
    const t = createHistoryTracker(history);
    const live = t.getLiveHistory();
    const full = t.getFullHistory();

    // Should have 3 messages: user, assistant(toolCalls), tool(cancelled)
    expect(live).toHaveLength(3);
    expect(full).toHaveLength(3);
    expect(live[2].role).toBe('tool');
    expect(live[2].toolCallId).toBe('call-1');
    expect(JSON.parse(live[2].content as string)).toEqual({ cancelled: true });
  });

  it('seals orphaned tool calls on create from liveHistory', () => {
    const full = [
      msg('user', 'hello'),
      toolCallMsg('call-1', 'tool_a'),
      toolResultMsg('call-1', 'tool_a', 'ok'),
      msg('assistant', 'done'),
    ];
    const live = [
      msg('user', 'hello'),
      toolCallMsg('call-2', 'tool_b'),
      // NOTE: call-2 has no result in live — orphaned!
    ];
    const t = createHistoryTracker(full, live);
    const sealedLive = t.getLiveHistory();
    const sealedFull = t.getFullHistory();

    // live should have had call-2 sealed
    expect(sealedLive).toHaveLength(3);
    expect(sealedLive[2].role).toBe('tool');
    expect(sealedLive[2].toolCallId).toBe('call-2');

    // full should be unchanged (call-1 already has a result, and there's no
    // orphan in full)
    expect(sealedFull).toHaveLength(4);
  });

  it('passes through valid tool call sequences without modification', () => {
    const history = [
      msg('user', 'do something'),
      toolCallMsg('call-1', 'search'),
      toolResultMsg('call-1', 'search', 'results'),
      msg('assistant', 'here are the results'),
    ];
    const t = createHistoryTracker(history);
    expect(t.getLiveHistory()).toHaveLength(4);
    expect(t.getFullHistory()).toHaveLength(4);
  });

  it('passes through history with no tool calls unchanged', () => {
    const history = [
      msg('user', 'hello'),
      msg('assistant', 'hi'),
      msg('user', 'how are you'),
      msg('assistant', 'fine'),
    ];
    const t = createHistoryTracker(history);
    expect(t.getLiveHistory()).toHaveLength(4);
    expect(t.getFullHistory()).toHaveLength(4);
  });

  it('handles empty history', () => {
    const t = createHistoryTracker();
    expect(t.getLiveHistory()).toEqual([]);
    expect(t.getFullHistory()).toEqual([]);
  });

  it('seals only orphaned calls when some have results and some do not', () => {
    const history = [
      msg('user', 'complex task'),
      // First assistant turn: two assistant messages each with one tool call
      toolCallMsg('call-1', 'search', 'let me search'),
      toolCallMsg('call-2', 'compute', 'let me compute'),
      // Only call-1 has a result — call-2 is orphaned
      toolResultMsg('call-1', 'search', 'found it'),
      msg('assistant', 'partial result'),
    ];
    const t = createHistoryTracker(history);
    const full = t.getFullHistory();
    // Expected order:
    //   0. user "complex task"
    //   1. assistant toolCalls=[call-1] "let me search"
    //   2. assistant toolCalls=[call-2] "let me compute"
    //   3. tool call-2 CANCELLED ← inserted right after the orphaned assistant
    //   4. tool call-1 "found it"
    //   5. assistant "partial result"
    expect(full).toHaveLength(6);
    // The cancelled result for call-2 is inserted right after assistant-call-2
    expect(full[3].role).toBe('tool');
    expect(full[3].toolCallId).toBe('call-2');
    expect(JSON.parse(full[3].content as string)).toEqual({ cancelled: true });
    // The original tool result for call-1 and the final assistant remain
    expect(full[4].role).toBe('tool');
    expect(full[4].toolCallId).toBe('call-1');
    expect(full[5].role).toBe('assistant');
    expect(full[5].content).toBe('partial result');
  });

  // ── Explicit sealOrphanedToolCalls() call after replaceBoth ────────────────

  it('seals orphaned tool calls after replaceBoth', () => {
    const t = createHistoryTracker();
    t.replaceBoth(
      [msg('user', 'do it'), toolCallMsg('call-x', 'some_tool')],
      [msg('user', 'do it'), toolCallMsg('call-x', 'some_tool')],
    );
    // replaceBoth does NOT auto-seal — caller must call sealOrphanedToolCalls
    expect(t.getLiveHistory()).toHaveLength(2);
    expect(t.getFullHistory()).toHaveLength(2);

    t.sealOrphanedToolCalls();
    expect(t.getLiveHistory()).toHaveLength(3);
    expect(t.getLiveHistory()[2].role).toBe('tool');
    expect(t.getLiveHistory()[2].toolCallId).toBe('call-x');
    expect(JSON.parse(t.getLiveHistory()[2].content as string)).toEqual({ cancelled: true });
    expect(t.getFullHistory()).toHaveLength(3);
  });

  // ── Complex real-world scenario ────────────────────────────────────────────

  it('seals orphaned calls in the exact bug scenario', () => {
    // This reproduces the exact bug from the issue:
    // User → Assistant(toolCalls=[create_stream_subagent]) ✓ has result
    // → Tool(result=...) → Assistant(toolCalls=[send_stream_message]) ✗ orphaned
    // → User(new message)
    const history = [
      msg('user', '造个会ask的agent'),
      toolCallMsg('call-1', 'create_stream_subagent', ''),
      toolResultMsg('call-1', 'create_stream_subagent', { created: 'inquisitor' }),
      toolCallMsg('call-2', 'send_stream_message', '已创建 inquisitor 子 agent 🎉'),
      // call-2 is orphaned — no tool result follows!
      msg('user', '你来用一下提问工具'),
    ];
    const t = createHistoryTracker(history);
    const full = t.getFullHistory();

    // Should have: user, assistant(call-1), tool(call-1), assistant(call-2),
    //              tool(call-2 cancelled), user
    expect(full).toHaveLength(6);
    // call-1 should still have its original result
    expect(full[2].role).toBe('tool');
    expect(full[2].toolCallId).toBe('call-1');
    expect(full[2].content).toEqual({ created: 'inquisitor' });
    // call-2 should now have a cancelled result inserted before the final user
    expect(full[4].role).toBe('tool');
    expect(full[4].toolCallId).toBe('call-2');
    expect(JSON.parse(full[4].content as string)).toEqual({ cancelled: true });
    // The last message is still the user's follow-up
    expect(full[5].role).toBe('user');
    expect(full[5].content).toBe('你来用一下提问工具');
  });

  it('handles multiple orphaned tool calls in one assistant message', () => {
    const history = [
      toolCallMsg('a', 'tool_a', ''),
      toolCallMsg('b', 'tool_b', ''),
      // Both a and b are orphaned
    ];
    // Since both `toolCallMsg` create separate assistant messages, we need
    // to create a single assistant with two tool calls and no results.
    const singleAssistantWithTwoCalls: AgentMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'tool_a', arguments: {} },
          { id: 'b', name: 'tool_b', arguments: {} },
        ],
      },
    ];
    const t = createHistoryTracker(singleAssistantWithTwoCalls);
    const full = t.getFullHistory();
    // Should have: assistant, tool(cancelled a), tool(cancelled b)
    expect(full).toHaveLength(3);
    expect(full[1].role).toBe('tool');
    expect(full[1].toolCallId).toBe('a');
    expect(full[2].role).toBe('tool');
    expect(full[2].toolCallId).toBe('b');
  });

  it('does not duplicate cancelled results when call IDs repeat', () => {
    const history: AgentMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'dup', name: 'tool_x', arguments: {} },
          { id: 'dup', name: 'tool_x', arguments: {} },
        ],
      },
    ];
    const t = createHistoryTracker(history);
    const full = t.getFullHistory();
    // Even if the same ID appears twice in one assistant message, we should
    // only insert ONE cancelled result per unique ID.
    const toolMsgs = full.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].toolCallId).toBe('dup');
  });

  it('does not modify an already-complete multi-turn sequence', () => {
    const history = [
      msg('user', 'q1'),
      toolCallMsg('c1', 't1'),
      toolResultMsg('c1', 't1', 'r1'),
      msg('assistant', 'done 1'),
      msg('user', 'q2'),
      toolCallMsg('c2', 't2'),
      toolResultMsg('c2', 't2', 'r2'),
      msg('assistant', 'done 2'),
    ];
    const t = createHistoryTracker(history);
    expect(t.getFullHistory()).toHaveLength(8);
    // Verify no extra tool messages were injected
    const toolMsgs = t.getFullHistory().filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
  });
});
