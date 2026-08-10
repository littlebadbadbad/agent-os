import { describe, it, expect } from 'vitest';
import { MAIN_CONVERSATION_ID, ctxKey } from '../toolset';
import type { ToolSetContext } from '../toolset';

describe('MAIN_CONVERSATION_ID', () => {
  it('is the string "main"', () => {
    expect(MAIN_CONVERSATION_ID).toBe('main');
  });
});

describe('ctxKey', () => {
  it('returns sessionId for the main conversation (conversationId === MAIN_CONVERSATION_ID)', () => {
    const ctx = {
      sessionId: 'session-123',
      conversationId: 'main',
      agentName: 'main-agent',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('session-123');
  });

  it('returns compound key for sub-agent conversations', () => {
    const ctx = {
      sessionId: 'session-456',
      conversationId: 'conv-789',
      agentName: 'sub-agent',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('session-456:sub-agent:conv-789');
  });

  it('handles sessionId with special characters', () => {
    const ctx = {
      sessionId: 'sess/a:b@c',
      conversationId: 'conv-x',
      agentName: 'agent-y',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('sess/a:b@c:agent-y:conv-x');
  });

  it('handles empty agentName', () => {
    const ctx = {
      sessionId: 'sess-1',
      conversationId: 'conv-2',
      agentName: '',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('sess-1::conv-2');
  });

  it('returns sessionId only when conversationId is exactly "main"', () => {
    const ctx = {
      sessionId: 'sess-abc',
      conversationId: 'main',
      agentName: 'agent-x',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('sess-abc');
  });

  it('does NOT match "main" as a substring (e.g. "main-2" is treated as sub-agent)', () => {
    const ctx = {
      sessionId: 'sess-1',
      conversationId: 'main-2',
      agentName: 'agent',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('sess-1:agent:main-2');
  });

  it('handles empty sessionId', () => {
    const ctx = {
      sessionId: '',
      conversationId: 'conv-1',
      agentName: 'agent',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe(':agent:conv-1');
  });

  it('handles conversationId === MAIN_CONVERSATION_ID with empty sessionId', () => {
    const ctx = {
      sessionId: '',
      conversationId: MAIN_CONVERSATION_ID,
      agentName: 'agent',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('');
  });

  it('handles colons in sessionId (no ambiguity because separators are single colons)', () => {
    const ctx = {
      sessionId: 'sess:a:b',
      conversationId: 'conv-c',
      agentName: 'agent-d',
    } as ToolSetContext;

    expect(ctxKey(ctx)).toBe('sess:a:b:agent-d:conv-c');
  });
});
