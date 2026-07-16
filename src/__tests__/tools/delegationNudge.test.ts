/**
 * Unit tests for delegationNudge.ts — the Delegation Nudge ToolSet.
 */

import { describe, it, expect, vi } from 'vitest';
import { createDelegationNudgeToolSet } from '../../tools/subagent/delegationNudge';
import type { ToolSetContext } from '@agent-type';

describe('createDelegationNudgeToolSet', () => {
  const CTX: ToolSetContext = { sessionId: 'sess-1', agentName: 'main', conversationId: 'main' };

  it('returns a ToolSet with name "delegation-nudge" and no tools', () => {
    const ts = createDelegationNudgeToolSet();
    expect(ts.name).toBe('delegation-nudge');
    expect(ts.tools).toEqual([]);
  });

  it('onBeforeRun resets the internal counter', () => {
    const ts = createDelegationNudgeToolSet();
    // Manually trigger onBeforeRun — counter resets to 0
    ts.onBeforeRun?.(CTX, []);
    // No large results yet → no system prompt
    const result = ts.onGetSystemPrompt?.(CTX);
    expect(result).toBeUndefined();
  });

  it('onToolResult counts large string results', () => {
    const ts = createDelegationNudgeToolSet();
    ts.onBeforeRun?.(CTX, []);

    // First large result (exceeds 5000 chars)
    const largeResult = { toolCallId: 'tc-1', name: 'read_file', result: 'x'.repeat(5001) };
    ts.onToolResult?.(CTX, 'read_file', largeResult);
    expect(ts.onGetSystemPrompt?.(CTX)).toBeUndefined();

    // Second large result
    ts.onToolResult?.(CTX, 'read_file', largeResult);
    expect(ts.onGetSystemPrompt?.(CTX)).toBeUndefined();

    // Third large result — triggers nudge
    ts.onToolResult?.(CTX, 'read_file', largeResult);
    const prompt = ts.onGetSystemPrompt?.(CTX);
    expect(prompt).toContain('Delegation reminder');
    expect(prompt).toContain('delegate_*_task');
  });

  it('onToolResult counts large JSON results', () => {
    const ts = createDelegationNudgeToolSet();
    ts.onBeforeRun?.(CTX, []);

    // JSON stringify of this must exceed 5000 chars
    const bigArray = { data: 'x'.repeat(6000) };
    for (let i = 0; i < 3; i++) {
      ts.onToolResult?.(CTX, 'query', { toolCallId: `tc-${i}`, name: 'query', result: bigArray });
    }

    const prompt = ts.onGetSystemPrompt?.(CTX);
    expect(prompt).toContain('Delegation reminder');
  });

  it('onToolResult ignores small results', () => {
    const ts = createDelegationNudgeToolSet();
    ts.onBeforeRun?.(CTX, []);

    for (let i = 0; i < 10; i++) {
      ts.onToolResult?.(CTX, 'echo', { toolCallId: `tc-${i}`, name: 'echo', result: 'small' });
    }

    const prompt = ts.onGetSystemPrompt?.(CTX);
    expect(prompt).toBeUndefined();
  });

  it('onToolResult returns the result unchanged', () => {
    const ts = createDelegationNudgeToolSet();
    ts.onBeforeRun?.(CTX, []);

    const result = { toolCallId: 'tc-1', name: 'echo', result: 'hello' };
    const returned = ts.onToolResult?.(CTX, 'echo', result);
    expect(returned).toBe(result);
  });

  it('maintains per-session isolation', () => {
    const ts = createDelegationNudgeToolSet();
    const ctxA: ToolSetContext = { sessionId: 'sess-a', agentName: 'main', conversationId: 'main' };
    const ctxB: ToolSetContext = { sessionId: 'sess-b', agentName: 'main', conversationId: 'main' };

    ts.onBeforeRun?.(ctxA, []);
    ts.onBeforeRun?.(ctxB, []);

    const large = { toolCallId: 'tc-1', name: 'read_file', result: 'x'.repeat(5001) };
    for (let i = 0; i < 3; i++) ts.onToolResult?.(ctxA, 'read_file', large);

    // Session A should have nudge
    expect(ts.onGetSystemPrompt?.(ctxA)).toContain('Delegation reminder');
    // Session B should not (no large results in B)
    expect(ts.onGetSystemPrompt?.(ctxB)).toBeUndefined();
  });
});
