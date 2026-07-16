/**
 * Unit tests for historyUtils.ts — shared history truncation utilities.
 */

import { describe, it, expect } from 'vitest';
import { truncateAtUserMessage } from '../../tools/historyUtils';
import type { AgentMessage } from '@agent-type';

function user(content: string): AgentMessage {
  return { role: 'user', content };
}

function assistant(content: string): AgentMessage {
  return { role: 'assistant', content };
}

describe('truncateAtUserMessage', () => {
  it('finds the Nth user message and truncates at it', () => {
    const history = [user('a'), assistant('r1'), user('b'), assistant('r2')];
    const result = truncateAtUserMessage(history, 2);
    expect(result.userIndex).toBe(2); // user('b') is at index 2
    expect(result.history).toEqual([user('a'), assistant('r1')]);
    expect(result.fullHistory).toEqual([user('a'), assistant('r1')]);
  });

  it('returns -1 when Nth user message is not found', () => {
    const history = [user('a')];
    const result = truncateAtUserMessage(history, 5);
    expect(result.userIndex).toBe(-1);
    expect(result.history).toEqual([]);
    expect(result.fullHistory).toEqual([]);
  });

  it('handles first user message', () => {
    const history = [user('first'), assistant('reply')];
    const result = truncateAtUserMessage(history, 1);
    expect(result.userIndex).toBe(0);
    expect(result.history).toEqual([]);
  });

  it('handles empty history', () => {
    const result = truncateAtUserMessage([], 1);
    expect(result.userIndex).toBe(-1);
  });

  it('counts only user messages (ignores assistant/tool)', () => {
    const history = [
      user('1'),
      assistant('r1'),
      user('2'),
      { role: 'tool', toolCallId: 'tc-1', name: 'echo', content: 'result' } as AgentMessage,
      assistant('r2'),
    ];
    const result = truncateAtUserMessage(history, 2);
    expect(result.userIndex).toBe(2);
    expect(result.history).toEqual([user('1'), assistant('r1')]);
  });
});
