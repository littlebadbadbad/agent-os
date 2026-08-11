import { describe, it, expect } from 'vitest';
import { analyzeContext, buildContextHint } from '../agent/context';
import type { AgentMessage } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function userMsg(content: string): AgentMessage {
  return { role: 'user', content };
}

function assistantMsg(content: string, opts?: { thinking?: string; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] }): AgentMessage {
  const base = { role: 'assistant' as const, content };
  if (!opts) return base;
  return {
    ...base,
    ...(opts.thinking !== undefined ? { thinking: opts.thinking } : {}),
    ...(opts.toolCalls ? { toolCalls: opts.toolCalls } : {}),
  };
}

function toolMsg(name: string, content: unknown): AgentMessage {
  return { role: 'tool', toolCallId: `tc-${name}`, name, content };
}

// ── analyzeContext ────────────────────────────────────────────────────────────

describe('analyzeContext', () => {
  it('returns all-zero breakdown for empty history', () => {
    const b = analyzeContext([]);
    expect(b.total).toBe(0);
    expect(b.userTokens).toBe(0);
    expect(b.assistantTextTokens).toBe(0);
    expect(b.toolCallTokens).toBe(0);
    expect(b.toolResultTokens).toBe(0);
    expect(b.thinkingTokens).toBe(0);
    expect(b.topToolResults).toEqual([]);
  });

  it('counts user message text', () => {
    const b = analyzeContext([userMsg('hello world')]);
    expect(b.userTokens).toBe(3);
    expect(b.total).toBe(3);
  });

  it('counts assistant text and thinking separately', () => {
    const b = analyzeContext([assistantMsg('short reply', { thinking: 'inner reasoning' })]);
    expect(b.assistantTextTokens).toBe(3);
    expect(b.thinkingTokens).toBeGreaterThan(0);
    expect(b.total).toBe(b.assistantTextTokens + b.thinkingTokens);
  });

  it('counts tool-call arguments JSON', () => {
    const b = analyzeContext([
      assistantMsg('', { toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'deep dive' } }] }),
    ]);
    expect(b.toolCallTokens).toBeGreaterThan(0);
    expect(b.assistantTextTokens).toBe(0);
  });

  it('counts string tool results and aggregates by name', () => {
    const b = analyzeContext([
      toolMsg('search', 'result one'),
      toolMsg('search', 'result two'),
      toolMsg('read', 'file contents'),
    ]);
    expect(b.toolResultTokens).toBeGreaterThan(0);
    expect(b.topToolResults[0].name).toBe('search');
    expect(b.topToolResults).toHaveLength(2);
  });

  it('serializes object tool results to JSON', () => {
    const b = analyzeContext([toolMsg('data', { key: 'value' })]);
    expect(b.toolResultTokens).toBeGreaterThan(0);
  });

  it('handles empty and null tool content', () => {
    const b = analyzeContext([toolMsg('noop', ''), toolMsg('nil', null)]);
    expect(b.toolResultTokens).toBe(0);
    expect(b.total).toBe(0);
  });

  it('keeps only the top three tool results by size', () => {
    const history: AgentMessage[] = [];
    for (let i = 0; i < 5; i++) {
      history.push(toolMsg(`tool-${i}`, 'x'.repeat((i + 1) * 100)));
    }
    const b = analyzeContext(history);
    expect(b.topToolResults).toHaveLength(3);
    expect(b.topToolResults[0].name).toBe('tool-4');
  });

  it('totals every contributor', () => {
    const history: AgentMessage[] = [
      userMsg('question'),
      assistantMsg('answer', { thinking: 'thought', toolCalls: [{ id: 't', name: 'tool', arguments: { a: 1 } }] }),
      toolMsg('tool', 'result'),
    ];
    const b = analyzeContext(history);
    expect(b.total).toBe(
      b.userTokens + b.assistantTextTokens + b.toolCallTokens + b.toolResultTokens + b.thinkingTokens,
    );
  });
});

// ── buildContextHint ──────────────────────────────────────────────────────────

describe('buildContextHint', () => {
  it('falls back to a generic hint when the breakdown is undefined', () => {
    const hint = buildContextHint(90, undefined);
    expect(hint).toContain('90% full');
    expect(hint).toContain('keep responses concise');
  });

  it('returns a generic hint when the breakdown total is zero', () => {
    const hint = buildContextHint(90, analyzeContext([]));
    expect(hint).toContain('90% full');
    expect(hint).toContain('keep responses concise');
  });

  it('highlights tool results when they dominate and are listed', () => {
    const history: AgentMessage[] = [
      toolMsg('readFile', 'y'.repeat(4000)),
      toolMsg('readFile', 'z'.repeat(4000)),
      userMsg('short'),
    ];
    const hint = buildContextHint(95, analyzeContext(history));
    expect(hint).toContain('tool results:');
    expect(hint).toContain('readFile');
    expect(hint).toContain('Avoid re-reading files already in context');
  });

  it('advises concision when assistant text dominates', () => {
    const history: AgentMessage[] = [
      userMsg('short'),
      assistantMsg('a'.repeat(3000)),
    ];
    const hint = buildContextHint(90, analyzeContext(history));
    expect(hint).toContain('assistant text:');
    expect(hint).toContain('Keep responses concise');
  });

  it('advises referencing previous context when user messages dominate', () => {
    const history: AgentMessage[] = [
      userMsg('u'.repeat(3000)),
      assistantMsg('short'),
    ];
    const hint = buildContextHint(90, analyzeContext(history));
    expect(hint).toContain('user messages:');
    expect(hint).toContain('Reference previous context');
  });

  it('advises reducing reasoning when thinking dominates', () => {
    const history: AgentMessage[] = [
      userMsg('short'),
      assistantMsg('short', { thinking: 't'.repeat(3000) }),
    ];
    const hint = buildContextHint(90, analyzeContext(history));
    expect(hint).toContain('thinking:');
    expect(hint).toContain('Reduce reasoning verbosity');
  });

  it('falls back to a generic wrap-up message otherwise', () => {
    // Balanced mix: no single contributor crosses its threshold (>50% tools,
    // >40% assistant, >30% user, >30% thinking).
    const history: AgentMessage[] = [
      userMsg('a'.repeat(40)),
      assistantMsg('b'.repeat(40), { thinking: 'c'.repeat(40) }),
      toolMsg('t', 'x'.repeat(120)),
    ];
    const hint = buildContextHint(85, analyzeContext(history));
    expect(hint).toContain('wrap up the current task promptly');
  });
});
