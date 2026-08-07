import { describe, it, expect } from 'vitest';
import { groupTurns, splitIntoChunks } from '../agent/summarize/chunks';
import type { AgentMessage } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function userMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function assistantMsg(content: string): AgentMessage {
  return { role: 'assistant', content };
}

function toolMsg(name: string, content: string): AgentMessage {
  return { role: 'tool', toolCallId: `tc-${name}`, name, content };
}

// ── groupTurns ────────────────────────────────────────────────────────────────

describe('groupTurns', () => {
  it('returns an empty list for empty input', () => {
    expect(groupTurns([])).toEqual([]);
  });

  it('keeps a lone user message as its own turn', () => {
    const turns = groupTurns([userMsg('hi')]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual([userMsg('hi')]);
  });

  it('attaches tool results to the preceding assistant turn', () => {
    const turns = groupTurns([
      userMsg('Q'),
      assistantMsg('A'),
      toolMsg('t', 'r'),
      toolMsg('t', 'r2'),
      userMsg('Q2'),
    ]);
    expect(turns).toHaveLength(3);
    expect(turns[1]).toHaveLength(3); // assistant + 2 tool results
    expect(turns[2]).toEqual([userMsg('Q2')]);
  });

  it('isolates a leading tool message as its own turn (malformed history)', () => {
    const turns = groupTurns([toolMsg('t', 'r'), userMsg('Q')]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual([toolMsg('t', 'r')]);
  });
});

// ── splitIntoChunks ───────────────────────────────────────────────────────────

describe('splitIntoChunks', () => {
  it('returns no chunks for empty input', () => {
    expect(splitIntoChunks([], 1000)).toEqual([]);
  });

  it('produces a single chunk when under the budget', () => {
    const history = [userMsg('Q1'), assistantMsg('A1'), userMsg('Q2')];
    const chunks = splitIntoChunks(history, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(history);
  });

  it('splits into multiple chunks when over the budget', () => {
    const history: AgentMessage[] = [];
    for (let i = 0; i < 6; i++) {
      history.push(userMsg(`Question ${i} with some padding text here`));
      history.push(assistantMsg(`Answer ${i} with some padding text here`));
    }
    const chunks = splitIntoChunks(history, 40);
    expect(chunks.length).toBeGreaterThan(1);
    // Every message must appear in exactly one chunk, in order.
    const flattened = chunks.flat();
    expect(flattened).toEqual(history);
  });

  it('never splits a tool result away from its assistant turn', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'),
      assistantMsg('A1'),
      toolMsg('t', 'result one'),
      toolMsg('t', 'result two'),
      userMsg('Q2'),
    ];
    const chunks = splitIntoChunks(history, 1); // force splits
    for (const chunk of chunks) {
      const hasTool = chunk.some((m) => m.role === 'tool');
      const hasAssistant = chunk.some((m) => m.role === 'assistant');
      expect(hasTool === hasAssistant).toBe(true); // tools travel with their assistant
    }
    expect(chunks.flat()).toEqual(history);
  });

  it('keeps an oversized single turn intact in its own chunk', () => {
    const big = toolMsg('big', 'x'.repeat(500));
    const history = [userMsg('Q'), assistantMsg('A'), big, userMsg('Q2')];
    const chunks = splitIntoChunks(history, 10);
    const bigChunk = chunks.find((c) => c.includes(big));
    expect(bigChunk).toBeDefined();
    expect(bigChunk!.length).toBeGreaterThanOrEqual(1);
  });
});
