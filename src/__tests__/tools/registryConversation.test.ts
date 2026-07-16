/**
 * Unit tests for `registryConversation.ts` — the low-level conversation data
 * structure and reactive state wrapper used by the flat sub-agent registry.
 *
 * Covers:
 *   - generateConvId
 *   - makeConversation (state, subscriptions, history access)
 *   - Internal _state / _notify / _notifyRegistry plumbing
 */

import { describe, it, expect, vi } from 'vitest';
import { generateConvId, makeConversation } from '../../tools/subagent/registryConversation';

describe('generateConvId', () => {
  it('returns a string starting with conv-', () => {
    const id = generateConvId();
    expect(id).toMatch(/^conv-/);
  });

  it('returns unique values on successive calls', () => {
    const a = generateConvId();
    const b = generateConvId();
    expect(a).not.toBe(b);
  });
});

describe('makeConversation', () => {
  const SESSION_ID = 'test-sess';
  const AGENT_NAME = 'test-agent';
  const TITLE = 'My Conversation';

  it('creates a conversation with correct initial state', () => {
    const conv = makeConversation('conv-1', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    const state = conv.getState();
    expect(state.id).toBe(SESSION_ID);
    expect(state.conversationId).toBe('conv-1');
    expect(state.agentName).toBe(AGENT_NAME);
    expect(state.title).toBe(TITLE);
    expect(state.isLoading).toBe(false);
    expect(state.streamingText).toBe('');
    expect(state.history).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  it('exposes _state with mutable backing store', () => {
    const conv = makeConversation('conv-2', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    expect(conv._state.id).toBe('conv-2');
    expect(conv._state.agentName).toBe(AGENT_NAME);
    expect(conv._state.title).toBe(TITLE);
    expect(conv._state.isLoading).toBe(false);
    expect(conv._state.streamingText).toBe('');
    expect(conv._state.tracker).toBeDefined();
    expect(conv._state.msgList).toBeDefined();
  });

  it('getState includes extra fields from getExtraState callback', () => {
    const conv = makeConversation('conv-3', SESSION_ID, TITLE, AGENT_NAME, vi.fn(), () => ({
      customField: 'extra-value',
    }));
    const state = conv.getState() as Record<string, unknown>;
    expect(state.customField).toBe('extra-value');
  });

  it('getHistory returns live history from tracker', () => {
    const conv = makeConversation('conv-4', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    conv._state.tracker.pushToBoth({ role: 'user', content: 'hello' });
    const history = conv.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('hello');
  });

  it('subscribe notifies on msgList mutation via _notify', () => {
    const conv = makeConversation('conv-5', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    const subscriber = vi.fn();
    conv.subscribe(subscriber);

    // Push to msgList should trigger conv subscriber via the bridge
    conv._state.msgList.push({
      id: 'msg-1', role: 'user', content: 'hi', isStreaming: false,
    });

    expect(subscriber).toHaveBeenCalled();
  });

  it('subscribe returns unsubscribe function that stops notifications', () => {
    const conv = makeConversation('conv-6', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    const subscriber = vi.fn();
    const unsub = conv.subscribe(subscriber);
    unsub();

    conv._state.msgList.push({
      id: 'msg-1', role: 'user', content: 'hi', isStreaming: false,
    });

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('_notifyRegistry calls notifyRegistry callback', () => {
    const notifyRegistry = vi.fn();
    const conv = makeConversation('conv-7', SESSION_ID, TITLE, AGENT_NAME, notifyRegistry);

    conv._notifyRegistry();

    expect(notifyRegistry).toHaveBeenCalledOnce();
  });

  it('_notify calls conv subscribers without calling notifyRegistry', () => {
    const notifyRegistry = vi.fn();
    const conv = makeConversation('conv-8', SESSION_ID, TITLE, AGENT_NAME, notifyRegistry);
    const subscriber = vi.fn();
    conv.subscribe(subscriber);

    conv._notify();

    expect(subscriber).toHaveBeenCalled();
    // notifyRegistry should NOT be called by _notify
    expect(notifyRegistry).not.toHaveBeenCalled();
  });

  it('getState updates after mutation — previous snapshot is invalidated', () => {
    const conv = makeConversation('conv-9', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    const state1 = conv.getState();
    expect(state1.isLoading).toBe(false);

    conv._state.isLoading = true;
    // _notify must be called to invalidate the cached snapshot
    conv._notify();
    const state2 = conv.getState();
    expect(state2.isLoading).toBe(true);

    // Snapshot objects should be different after invalidation
    expect(state1).not.toBe(state2);
  });

  it('getHistory returns the same live history reference from tracker', () => {
    const conv = makeConversation('conv-10', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    conv._state.tracker.pushToBoth({ role: 'user', content: 'first' });
    expect(conv.getHistory()).toHaveLength(1);
    conv._state.tracker.pushToBoth({ role: 'assistant', content: 'second' });
    expect(conv.getHistory()).toHaveLength(2);
  });

  it('handles multiple subscribers', () => {
    const conv = makeConversation('conv-11', SESSION_ID, TITLE, AGENT_NAME, vi.fn());
    const sub1 = vi.fn();
    const sub2 = vi.fn();
    conv.subscribe(sub1);
    conv.subscribe(sub2);

    conv._notify();

    expect(sub1).toHaveBeenCalledOnce();
    expect(sub2).toHaveBeenCalledOnce();
  });

  it('_notifyRegistry also notifies conversation subscribers', () => {
    const notifyRegistry = vi.fn();
    const conv = makeConversation('conv-12', SESSION_ID, TITLE, AGENT_NAME, notifyRegistry);
    const subscriber = vi.fn();
    conv.subscribe(subscriber);

    conv._notifyRegistry();

    expect(subscriber).toHaveBeenCalled();
    expect(notifyRegistry).toHaveBeenCalled();
  });
});
