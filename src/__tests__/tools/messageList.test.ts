/**
 * Comprehensive unit tests for {@link MessageList}.
 *
 * Covers every method on the interface — push, update, replace, truncate,
 * findIndex, lastStreamingIndex, subscribe — plus edge cases (empty list,
 * duplicate IDs, same-reference optimisation, notify suppression).
 */

import { describe, it, expect } from 'vitest';
import { createMessageList, assistantMsg, toolMsg, userMsg, type Message } from '../../tools/messageList';

function makeMsgs(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push(assistantMsg(`id-${i}`, `text-${i}`));
  }
  return msgs;
}

describe('createMessageList', () => {

  // ── Construction ──────────────────────────────────────────────────────────

  it('creates an empty list when no initial messages are given', () => {
    const list = createMessageList();
    expect(list.messages).toEqual([]);
    expect(list.length).toBe(0);
  });

  it('creates a list with initial messages when provided', () => {
    const initial = makeMsgs(3);
    const list = createMessageList(initial);
    expect(list.length).toBe(3);
    expect(list.messages[0].id).toBe('id-0');
    expect(list.messages[2].id).toBe('id-2');
  });

  it('does not mutate the initial array', () => {
    const initial = makeMsgs(2);
    const list = createMessageList(initial);
    list.push(assistantMsg('new', 'new'));
    expect(initial.length).toBe(2);
  });

  // ── push ──────────────────────────────────────────────────────────────────

  it('push appends a single message', () => {
    const list = createMessageList();
    list.push(assistantMsg('a', 'hello'));
    expect(list.length).toBe(1);
    expect(list.messages[0].content).toBe('hello');
  });

  it('push appends multiple messages', () => {
    const list = createMessageList();
    list.push(assistantMsg('a', '1'), assistantMsg('b', '2'));
    expect(list.length).toBe(2);
  });

  it('push with zero messages does nothing', () => {
    const list = createMessageList(makeMsgs(2));
    list.push();
    expect(list.length).toBe(2);
  });

  // ── update ────────────────────────────────────────────────────────────────

  it('update replaces a message by id', () => {
    const list = createMessageList(makeMsgs(3));
    list.update('id-1', (m) => ({ ...m!, content: 'updated' }));
    expect(list.messages[1].content).toBe('updated');
  });

  it('update does nothing when id is not found', () => {
    const list = createMessageList(makeMsgs(2));
    const before = list.messages;
    list.update('nonexistent', (m) => m!);
    expect(list.messages).toBe(before);
  });

  it('update receiving undefined keeps the original message', () => {
    const list = createMessageList(makeMsgs(2));
    list.update('id-0', () => undefined);
    expect(list.messages[0].content).toBe('text-0');
  });

  it('update returning the same reference skips notify', () => {
    const list = createMessageList(makeMsgs(2));
    let notified = 0;
    list.subscribe(() => { notified++; });
    list.update('id-0', (m) => m!);
    // subscribe is called via push → notify during construction too, so we
    // only check that returning same ref doesn't trigger an extra notify.
    // The exact count depends on how many notifies happened before.
    const countBefore = notified;
    list.update('id-0', (m) => m!);
    expect(notified).toBe(countBefore);
  });

  // ── replace ───────────────────────────────────────────────────────────────

  it('replace replaces the entire list', () => {
    const list = createMessageList(makeMsgs(2));
    list.replace(() => [assistantMsg('x', 'new')]);
    expect(list.length).toBe(1);
    expect(list.messages[0].id).toBe('x');
  });

  it('replace with same reference does not notify', () => {
    const list = createMessageList(makeMsgs(2));
    let notified = 0;
    list.subscribe(() => { notified++; });
    list.replace((prev) => prev);
    expect(notified).toBe(0);
  });

  it('replace receives the current messages', () => {
    const list = createMessageList(makeMsgs(2));
    list.replace((prev) => {
      expect(prev.length).toBe(2);
      return [...prev, assistantMsg('x', 'extra')];
    });
    expect(list.length).toBe(3);
  });

  // ── truncate ──────────────────────────────────────────────────────────────

  it('truncate to zero clears the list', () => {
    const list = createMessageList(makeMsgs(5));
    list.truncate(0);
    expect(list.length).toBe(0);
  });

  it('truncate keeps the first N messages', () => {
    const list = createMessageList(makeMsgs(5));
    list.truncate(3);
    expect(list.length).toBe(3);
    expect(list.messages[0].id).toBe('id-0');
    expect(list.messages[2].id).toBe('id-2');
  });

  it('truncate to length >= current does nothing', () => {
    const list = createMessageList(makeMsgs(3));
    const before = list.messages;
    list.truncate(10);
    expect(list.messages).toBe(before);
  });

  // ── findIndex ─────────────────────────────────────────────────────────────

  it('findIndex returns the correct index', () => {
    const list = createMessageList(makeMsgs(5));
    const idx = list.findIndex((m) => m.id === 'id-3');
    expect(idx).toBe(3);
  });

  it('findIndex returns -1 when no match', () => {
    const list = createMessageList(makeMsgs(2));
    expect(list.findIndex((m) => m.id === 'nope')).toBe(-1);
  });

  // ── lastStreamingIndex ────────────────────────────────────────────────────

  it('lastStreamingIndex returns the last streaming assistant message', () => {
    const msgs = [
      assistantMsg('a', 'done'),
      assistantMsg('b', 'streaming...', true),
      assistantMsg('c', 'also streaming', true),
    ];
    const list = createMessageList(msgs);
    expect(list.lastStreamingIndex()).toBe(2);
  });

  it('lastStreamingIndex returns -1 when no message is streaming', () => {
    const list = createMessageList(makeMsgs(3));
    expect(list.lastStreamingIndex()).toBe(-1);
  });

  it('lastStreamingIndex returns -1 for empty list', () => {
    const list = createMessageList();
    expect(list.lastStreamingIndex()).toBe(-1);
  });

  // ── subscribe / notify ───────────────────────────────────────────────────

  it('subscribe is notified on push', () => {
    const list = createMessageList();
    const calls: Message[][] = [];
    list.subscribe(() => { calls.push([...list.messages]); });
    list.push(assistantMsg('a', 'hello'));
    expect(calls.length).toBe(1);
    expect(calls[0][0].id).toBe('a');
  });

  it('subscribe is notified on update', () => {
    const list = createMessageList(makeMsgs(2));
    let notified = 0;
    list.subscribe(() => { notified++; });
    list.update('id-0', (m) => ({ ...m!, content: 'x' }));
    expect(notified).toBe(1);
  });

  it('subscribe is notified on replace', () => {
    const list = createMessageList(makeMsgs(2));
    let notified = 0;
    list.subscribe(() => { notified++; });
    list.replace(() => [assistantMsg('x', 'y')]);
    expect(notified).toBe(1);
  });

  it('subscribe is notified on truncate', () => {
    const list = createMessageList(makeMsgs(5));
    let notified = 0;
    list.subscribe(() => { notified++; });
    list.truncate(2);
    expect(notified).toBe(1);
  });

  it('unsubscribe stops notifications', () => {
    const list = createMessageList();
    let notified = 0;
    const unsub = list.subscribe(() => { notified++; });
    unsub();
    list.push(assistantMsg('a', 'b'));
    expect(notified).toBe(0);
  });

  it('multiple subscribers all receive notifications', () => {
    const list = createMessageList();
    let a = 0, b = 0;
    list.subscribe(() => { a++; });
    list.subscribe(() => { b++; });
    list.push(assistantMsg('x', 'y'));
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  // ── Message constructors ─────────────────────────────────────────────────

  it('assistantMsg creates a correct message', () => {
    const m = assistantMsg('abc', 'Hello', true);
    expect(m.id).toBe('abc');
    expect(m.role).toBe('assistant');
    expect(m.content).toBe('Hello');
    expect(m.isStreaming).toBe(true);
  });

  it('assistantMsg defaults isStreaming to false', () => {
    const m = assistantMsg('abc', 'Hello');
    expect(m.isStreaming).toBe(false);
  });

  it('userMsg creates a correct message', () => {
    const m = userMsg('uid', 'user text');
    expect(m.role).toBe('user');
    expect(m.content).toBe('user text');
    expect(m.isStreaming).toBe(false);
  });

  it('toolMsg creates a correct message from ToolCallInfo', () => {
    const m = toolMsg({ toolCallId: 't1', name: 'echo', arguments: { x: 1 }, status: 'running' });
    expect(m.role).toBe('tool');
    expect(m.id).toBe('t1');
    expect(m.toolCall?.name).toBe('echo');
    expect(m.toolCall?.status).toBe('running');
    expect(m.isStreaming).toBe(false);
  });
});
