/**
 * Tests for ctxKey and related runtime utilities from agent-type/toolset.ts
 * and src/tools/toolSet.ts.
 */

import { describe, it, expect } from 'vitest';
import { MAIN_CONVERSATION_ID, ctxKey } from '@agent-type';
import type { ToolSetContext } from '@agent-type';
import { TOOL_STATE_TOOLSET_BRAND, canSuppressPrompt } from '../../tools/toolSet';

describe('MAIN_CONVERSATION_ID', () => {
  it('is the string "main"', () => {
    expect(MAIN_CONVERSATION_ID).toBe('main');
  });
});

describe('ctxKey', () => {
  const SESSION_ID = 'sess-abc-123';

  it('returns sessionId for main conversation', () => {
    const ctx: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'main',
      conversationId: MAIN_CONVERSATION_ID,
    };
    expect(ctxKey(ctx)).toBe(SESSION_ID);
  });

  it('returns composite key for sub-agent conversation', () => {
    const ctx: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'researcher',
      conversationId: 'conv-xyz',
    };
    expect(ctxKey(ctx)).toBe('sess-abc-123:researcher:conv-xyz');
  });

  it('includes agentName and conversationId in composite key', () => {
    const ctxA: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'agent-a',
      conversationId: 'conv-1',
    };
    const ctxB: ToolSetContext = {
      sessionId: SESSION_ID,
      agentName: 'agent-b',
      conversationId: 'conv-1',
    };
    const keyA = ctxKey(ctxA);
    const keyB = ctxKey(ctxB);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('sess-abc-123:agent-a:conv-1');
    expect(keyB).toBe('sess-abc-123:agent-b:conv-1');
  });
});

describe('TOOL_STATE_TOOLSET_BRAND', () => {
  it('is a well-known Symbol', () => {
    expect(typeof TOOL_STATE_TOOLSET_BRAND).toBe('symbol');
    expect(Symbol.for('sdk.ToolStateToolSet')).toBe(TOOL_STATE_TOOLSET_BRAND);
  });
});

describe('canSuppressPrompt', () => {
  it('returns true when brand symbol is set to true', () => {
    const ts = {
      name: 'branded_ts',
      tools: [],
      [TOOL_STATE_TOOLSET_BRAND]: true,
    };
    expect(canSuppressPrompt(ts)).toBe(true);
  });

  it('returns false when brand symbol is not set', () => {
    const ts = { name: 'unbranded_ts', tools: [] };
    expect(canSuppressPrompt(ts)).toBe(false);
  });

  it('returns false when brand symbol is set to false', () => {
    const ts = {
      name: 'false_branded_ts',
      tools: [],
      [TOOL_STATE_TOOLSET_BRAND]: false,
    };
    expect(canSuppressPrompt(ts)).toBe(false);
  });

  it('returns false when brand symbol is set to a non-boolean value', () => {
    const ts = {
      name: 'string_branded_ts',
      tools: [],
      [TOOL_STATE_TOOLSET_BRAND]: 'yes',
    };
    expect(canSuppressPrompt(ts)).toBe(false);
  });
});
