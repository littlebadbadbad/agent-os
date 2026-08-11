import { describe, it, expect } from 'vitest';
import { clearToolResults, buildStages } from '../agent/compaction';
import { CLEARED_TOOL_RESULT } from '../agent/summarize/constants';
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

/** A history long enough to compact: 3 user/assistant pairs + 3 tool results. */
function buildHistory(): AgentMessage[] {
  return [
    userMsg('Q1'),
    assistantMsg('A1'),
    toolMsg('read', 'y'.repeat(1000)),
    toolMsg('search', 'z'.repeat(1000)),
    userMsg('Q2'),
    assistantMsg('A2'),
    toolMsg('read', 'w'.repeat(1000)),
    userMsg('Q3'),
    assistantMsg('A3'),
  ];
}

// ── clearToolResults ──────────────────────────────────────────────────────────

describe('clearToolResults', () => {
  it('returns null when history is too short', () => {
    const result = clearToolResults([userMsg('Q1'), assistantMsg('A1'), userMsg('Q2')], 4);
    expect(result).toBeNull();
  });

  it('returns null when there are no tool messages worth clearing', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'), assistantMsg('A1'),
      userMsg('Q2'), assistantMsg('A2'),
      userMsg('Q3'), assistantMsg('A3'),
      userMsg('Q4'), assistantMsg('A4'),
    ];
    const result = clearToolResults(history, 2);
    expect(result).toBeNull();
  });

  it('returns null when tool results are not larger than the placeholder', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'), assistantMsg('A1'), toolMsg('tiny', 'x'),
      userMsg('Q2'), assistantMsg('A2'), toolMsg('tiny', 'y'),
      userMsg('Q3'), assistantMsg('A3'), toolMsg('tiny', 'z'),
      userMsg('Q4'), assistantMsg('A4'),
    ];
    const result = clearToolResults(history, 2);
    expect(result).toBeNull();
  });

  it('replaces old tool results with a placeholder and reports savings', () => {
    const result = clearToolResults(buildHistory(), 2);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('tool-results-cleared');
    expect(result!.savedTokens).toBeGreaterThan(0);

    const clearedTools = result!.messages.filter((m) => m.role === 'tool');
    expect(clearedTools.length).toBeGreaterThan(0);
    for (const msg of clearedTools) {
      expect(msg.content).toBe(CLEARED_TOOL_RESULT);
    }
  });

  it('preserves user and assistant messages verbatim', () => {
    const result = clearToolResults(buildHistory(), 2);
    const original = buildHistory();
    const compacted = result!.messages;

    // Every non-tool message must appear unchanged and in order.
    const nonToolOriginal = original.filter((m) => m.role !== 'tool');
    const nonToolCompacted = compacted.filter((m) => m.role !== 'tool');
    expect(nonToolCompacted).toEqual(nonToolOriginal);
  });

  it('keeps recent messages fully intact (including their tool results)', () => {
    const result = clearToolResults(buildHistory(), 2);
    const compacted = result!.messages;
    const tail = compacted.slice(-2);
    expect(tail[0].role).toBe('user');
    expect(tail[1].role).toBe('assistant');
  });

  it('treats null and undefined tool content as empty (no savings)', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'), assistantMsg('A1'), { role: 'tool', toolCallId: 'tc-null', name: 'nil', content: null },
      userMsg('Q2'), assistantMsg('A2'), { role: 'tool', toolCallId: 'tc-undef', name: 'nil', content: undefined },
      userMsg('Q3'), assistantMsg('A3'),
      userMsg('Q4'), assistantMsg('A4'),
    ];
    const result = clearToolResults(history, 2);
    expect(result).toBeNull();
  });

  it('serializes object tool content to JSON before token estimation', () => {
    const history: AgentMessage[] = [
      userMsg('Q1'), assistantMsg('A1'),
      { role: 'tool', toolCallId: 'tc-obj', name: 'data', content: { big: 'x'.repeat(1000) } },
      userMsg('Q2'), assistantMsg('A2'),
      userMsg('Q3'), assistantMsg('A3'),
      userMsg('Q4'), assistantMsg('A4'),
    ];
    const result = clearToolResults(history, 2);
    expect(result).not.toBeNull();
    if (result) {
      const objTool = result.messages.find((m) => m.role === 'tool');
      expect(objTool?.content).toBe(CLEARED_TOOL_RESULT);
    }
  });

  it('keeps the history length unchanged (messages are replaced, not removed)', () => {
    const result = clearToolResults(buildHistory(), 2);
    expect(result!.messages.length).toBe(buildHistory().length);
  });
});

// ── buildStages ───────────────────────────────────────────────────────────────

describe('buildStages', () => {
  it('returns no stages below the soft threshold', () => {
    expect(buildStages(0.5, 0.85, 0.92, 0.97, 200)).toEqual([]);
  });

  it('returns only the soft stage in the soft-to-hard range', () => {
    const stages = buildStages(0.88, 0.85, 0.92, 0.97, 200);
    expect(stages).toEqual([{ keepRecent: 4, minSaved: 200 }]);
  });

  it('adds the hard stage in the hard-to-emergency range', () => {
    const stages = buildStages(0.94, 0.85, 0.92, 0.97, 200);
    expect(stages).toEqual([
      { keepRecent: 4, minSaved: 200 },
      { keepRecent: 2, minSaved: 100 },
    ]);
  });

  it('adds the emergency stage at the emergency threshold', () => {
    const stages = buildStages(0.99, 0.85, 0.92, 0.97, 200);
    expect(stages).toEqual([
      { keepRecent: 4, minSaved: 200 },
      { keepRecent: 2, minSaved: 100 },
      { keepRecent: 1, minSaved: 1 },
    ]);
  });

  it('accepts a boundary ratio equal to the soft threshold', () => {
    const stages = buildStages(0.85, 0.85, 0.92, 0.97, 200);
    expect(stages).toHaveLength(1);
  });
});
