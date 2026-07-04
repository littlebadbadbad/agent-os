/**
 * Tests for createPendingInputStore and createPendingInputToolSet.
 *
 * Focuses on the multi-message all-at-once injection behavior (post Change 2):
 *  - resume() sends the first message and keeps the rest in the queue
 *  - drainForInvoke() returns ALL remaining queued messages at once
 *  - onBeforeInvoke() hook returns all drained entries as user messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPendingInputStore } from '../../tools/pendingInput/store';
import { createPendingInputToolSet } from '../../tools/pendingInput/toolSet';
import type { ToolSetContext } from '@agent-type';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';

// ── createPendingInputStore ───────────────────────────────────────────────────

describe('createPendingInputStore', () => {
  let store: ReturnType<typeof createPendingInputStore>;
  const KEY = 'test-session';

  beforeEach(() => {
    store = createPendingInputStore();
  });

  it('starts with an empty queue', () => {
    expect(store.getQueue(KEY)).toHaveLength(0);
  });

  it('enqueue/getQueue round-trip', () => {
    store.enqueue(KEY, { id: '1', text: 'hello' });
    store.enqueue(KEY, { id: '2', text: 'world' });
    const q = store.getQueue(KEY);
    expect(q).toHaveLength(2);
    expect(q[0].text).toBe('hello');
    expect(q[1].text).toBe('world');
  });

  it('cancel removes the entry', () => {
    store.enqueue(KEY, { id: '1', text: 'hello' });
    store.enqueue(KEY, { id: '2', text: 'world' });
    store.cancel(KEY, '1');
    const q = store.getQueue(KEY);
    expect(q).toHaveLength(1);
    expect(q[0].text).toBe('world');
  });

  it('notify fires on enqueue', () => {
    const fn = vi.fn();
    store.subscribe(KEY, fn);
    store.enqueue(KEY, { id: '1', text: 'hello' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notify fires on cancel', () => {
    store.enqueue(KEY, { id: '1', text: 'hello' });
    const fn = vi.fn();
    store.subscribe(KEY, fn);
    store.cancel(KEY, '1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  describe('drainForInvoke', () => {
    it('returns empty array when queue is empty', () => {
      expect(store.drainForInvoke(KEY)).toHaveLength(0);
    });

    it('returns ALL entries and empties the queue', () => {
      store.enqueue(KEY, { id: '1', text: 'M1' });
      store.enqueue(KEY, { id: '2', text: 'M2' });
      store.enqueue(KEY, { id: '3', text: 'M3' });

      const drained = store.drainForInvoke(KEY);
      expect(drained).toHaveLength(3);
      expect(drained.map((e) => e.text)).toEqual(['M1', 'M2', 'M3']);
      expect(store.getQueue(KEY)).toHaveLength(0);
    });

    it('does NOT call notify (no spurious subscriber call)', () => {
      store.enqueue(KEY, { id: '1', text: 'M1' });
      const fn = vi.fn();
      store.subscribe(KEY, fn);
      store.drainForInvoke(KEY);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('resume (multi-message all-at-once model)', () => {
    it('no-ops when queue is empty', () => {
      const send = vi.fn();
      store.setSendMessage(KEY, send);
      store.resume(KEY);
      expect(send).not.toHaveBeenCalled();
    });

    it('with one message: sends it and leaves queue empty', () => {
      const send = vi.fn();
      store.setSendMessage(KEY, send);
      store.enqueue(KEY, { id: '1', text: 'M1' });
      store.resume(KEY);
      expect(send).toHaveBeenCalledWith('M1');
      expect(store.getQueue(KEY)).toHaveLength(0);
    });

    it('with multiple messages: sends first, leaves rest in queue', () => {
      const send = vi.fn();
      store.setSendMessage(KEY, send);
      store.enqueue(KEY, { id: '1', text: 'M1' });
      store.enqueue(KEY, { id: '2', text: 'M2' });
      store.enqueue(KEY, { id: '3', text: 'M3' });
      store.resume(KEY);
      expect(send).toHaveBeenCalledWith('M1');
      // M2 and M3 remain — to be drained by drainForInvoke on the new run's turn 0
      const remaining = store.getQueue(KEY);
      expect(remaining).toHaveLength(2);
      expect(remaining.map((e) => e.text)).toEqual(['M2', 'M3']);
    });

    it('with multiple messages: notify fires with remaining queue state', () => {
      const fn = vi.fn();
      store.subscribe(KEY, fn);
      const send = vi.fn();
      store.setSendMessage(KEY, send);
      store.enqueue(KEY, { id: '1', text: 'M1' });
      store.enqueue(KEY, { id: '2', text: 'M2' });
      fn.mockClear(); // clear enqueue notifications

      store.resume(KEY);
      // notify fired once (after removing M1, before sendMessage)
      expect(fn).toHaveBeenCalledTimes(1);
      // At the time of notify, queue should contain [M2]
      expect(store.getQueue(KEY)).toHaveLength(1);
    });

    it('remaining entries from resume are ALL drained by drainForInvoke', () => {
      const send = vi.fn();
      store.setSendMessage(KEY, send);
      store.enqueue(KEY, { id: '1', text: 'M1' });
      store.enqueue(KEY, { id: '2', text: 'M2' });
      store.enqueue(KEY, { id: '3', text: 'M3' });
      store.resume(KEY);

      // Simulate what onBeforeInvoke does on the new run's first turn
      const drained = store.drainForInvoke(KEY);
      expect(drained).toHaveLength(2);
      expect(drained.map((e) => e.text)).toEqual(['M2', 'M3']);
      expect(store.getQueue(KEY)).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('empties the queue', () => {
      store.enqueue(KEY, { id: '1', text: 'M1' });
      store.enqueue(KEY, { id: '2', text: 'M2' });
      store.reset(KEY);
      expect(store.getQueue(KEY)).toHaveLength(0);
    });

    it('notify fires on reset', () => {
      store.enqueue(KEY, { id: '1', text: 'M1' });
      const fn = vi.fn();
      store.subscribe(KEY, fn);
      store.reset(KEY);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

// ── createPendingInputToolSet ─────────────────────────────────────────────────

describe('createPendingInputToolSet', () => {
  const SESSION_ID = 'test-session';
  const ctx: ToolSetContext = {
    sessionId: SESSION_ID,
    agentName: MAIN_CONVERSATION_ID,
    conversationId: MAIN_CONVERSATION_ID,
  };

  it('onBeforeInvoke returns empty array when queue is empty', () => {
    const ts = createPendingInputToolSet();
    const result = ts.onBeforeInvoke!(ctx);
    expect(result).toHaveLength(0);
  });

  it('onBeforeInvoke returns all queued messages as user AgentMessages', () => {
    const ts = createPendingInputToolSet();
    // Queue via onGetState's queueUserInput
    const state = ts.onGetState!(ctx) as any;
    state.queueUserInput('hello');
    state.queueUserInput('world');

    const result = ts.onBeforeInvoke!(ctx);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'hello' });
    expect(result[1]).toEqual({ role: 'user', content: 'world' });
  });

  it('onBeforeInvoke drains the queue (calling it twice returns empty second time)', () => {
    const ts = createPendingInputToolSet();
    const state = ts.onGetState!(ctx) as any;
    state.queueUserInput('M1');
    state.queueUserInput('M2');

    ts.onBeforeInvoke!(ctx); // first call drains
    const second = ts.onBeforeInvoke!(ctx);
    expect(second).toHaveLength(0);
  });

  it('onGetState reflects queue after queueUserInput', () => {
    const ts = createPendingInputToolSet();
    const state1 = ts.onGetState!(ctx) as any;
    expect(state1.pendingInputCount).toBe(0);
    expect(state1.pendingInputMessages).toHaveLength(0);

    state1.queueUserInput('hi');
    const state2 = ts.onGetState!(ctx) as any;
    expect(state2.pendingInputCount).toBe(1);
    expect(state2.pendingInputMessages[0].text).toBe('hi');
  });

  it('onAfterRun does NOT call resume on aborted outcome', () => {
    const ts = createPendingInputToolSet();
    const sendMock = vi.fn();
    ts.onSessionReady!(ctx, sendMock);

    const state = ts.onGetState!(ctx) as any;
    state.queueUserInput('M1');

    ts.onAfterRun!(ctx, 'aborted');
    expect(sendMock).not.toHaveBeenCalled();
    // queue is preserved
    expect((ts.onGetState!(ctx) as any).pendingInputCount).toBe(1);
  });

  it('onAfterRun sends first message on completed outcome (multi-message)', () => {
    const ts = createPendingInputToolSet();
    const sendMock = vi.fn();
    ts.onSessionReady!(ctx, sendMock);

    const state = ts.onGetState!(ctx) as any;
    state.queueUserInput('M1');
    state.queueUserInput('M2');
    state.queueUserInput('M3');

    ts.onAfterRun!(ctx, 'completed');
    expect(sendMock).toHaveBeenCalledWith('M1');

    // M2 and M3 remain for drainForInvoke
    expect((ts.onGetState!(ctx) as any).pendingInputCount).toBe(2);
    expect((ts.onGetState!(ctx) as any).pendingInputMessages.map((m: any) => m.text)).toEqual(['M2', 'M3']);
  });

  it('stable callbacks: queueUserInput ref stays the same across onGetState calls', () => {
    const ts = createPendingInputToolSet();
    const state1 = ts.onGetState!(ctx) as any;
    const state2 = ts.onGetState!(ctx) as any;
    expect(state1.queueUserInput).toBe(state2.queueUserInput);
    expect(state1.cancelQueuedInput).toBe(state2.cancelQueuedInput);
    expect(state1.resumeQueuedInputs).toBe(state2.resumeQueuedInputs);
  });
});
