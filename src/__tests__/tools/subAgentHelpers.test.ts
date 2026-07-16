/**
 * Unit tests for subAgentHelpers.ts — shared utility functions for sub-agent
 * tool definitions.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parentFromContext,
  getCallerToolNames,
  buildPoolNames,
  resolveConvId,
} from '../../tools/subagent/subAgentHelpers';
import type { AgentQueryFns } from '@agent-type';

// ── parentFromContext ─────────────────────────────────────────────────────────

describe('parentFromContext', () => {
  it('returns "agentName:conversationId" format', () => {
    const result = parentFromContext({ agentName: 'main', conversationId: 'main' });
    expect(result).toBe('main:main');
  });

  it('works with sub-agent context', () => {
    const result = parentFromContext({ agentName: 'researcher', conversationId: 'conv-123' });
    expect(result).toBe('researcher:conv-123');
  });
});

// ── getCallerToolNames ───────────────────────────────────────────────────────

describe('getCallerToolNames', () => {
  it('returns null when caller is the main agent (not a sub-agent)', () => {
    const getState = vi.fn(() => ({ subAgents: [] }));
    const result = getCallerToolNames(getState, 'sess-1', 'main');
    expect(result).toBeNull();
  });

  it('returns Set of tool names when caller is a registered sub-agent', () => {
    const getState = vi.fn(() => ({
      subAgents: [
        { name: 'worker', toolNames: ['tool_a', 'tool_b'] },
      ],
    }));
    const result = getCallerToolNames(getState, 'sess-1', 'worker');
    expect(result).toEqual(new Set(['tool_a', 'tool_b']));
  });

  it('returns null when caller is not found in registry', () => {
    const getState = vi.fn(() => ({
      subAgents: [
        { name: 'worker', toolNames: ['tool_a'] },
      ],
    }));
    const result = getCallerToolNames(getState, 'sess-1', 'unknown');
    expect(result).toBeNull();
  });
});

// ── buildPoolNames ────────────────────────────────────────────────────────────

describe('buildPoolNames', () => {
  function makeAgent(tools: string[]): () => AgentQueryFns {
    return () => ({
      getTools: vi.fn(() => tools.map((n) => ({ name: n, description: '', parameters: {} as any, execute: async () => {} }))),
      getFilteredTools: vi.fn(() => tools.map((n) => ({ name: n, description: '', parameters: {} as any, execute: async () => {} }))),
      getRegisteredToolSets: vi.fn(() => []),
      handler: vi.fn() as any,
    } as unknown as AgentQueryFns);
  }

  it('returns tool names as bullet list, excluding specified names', () => {
    const getAgent = makeAgent(['tool_a', 'tool_b', 'tool_c']);
    const result = buildPoolNames(getAgent, new Set(['tool_b']));
    expect(result).toBe('- tool_a\n- tool_c');
  });

  it('returns empty string when getAgent throws (not attached yet)', () => {
    const getAgent = () => { throw new Error('not attached'); };
    const result = buildPoolNames(getAgent, new Set());
    expect(result).toBe('');
  });

  it('includes all tools when exclusion set is empty', () => {
    const getAgent = makeAgent(['tool_a', 'tool_b']);
    const result = buildPoolNames(getAgent, new Set());
    expect(result).toBe('- tool_a\n- tool_b');
  });
});

// ── resolveConvId ─────────────────────────────────────────────────────────────

describe('resolveConvId', () => {
  function makeRegistry(subAgents: any[] = []) {
    return {
      getState: vi.fn(() => ({ subAgents })),
      createConversation: vi.fn(),
    } as any;
  }

  it('returns explicit conversationId when provided', () => {
    const registry = makeRegistry();
    const result = resolveConvId(registry, 'agent-x', 'conv-abc');
    expect(result).toBe('conv-abc');
  });

  it('returns active conversation ID when conversationId is omitted', () => {
    const registry = makeRegistry([
      {
        name: 'agent-x',
        activeConversationId: 'conv-active',
        conversations: [{ conversationId: 'conv-active' }],
      },
    ]);
    const result = resolveConvId(registry, 'agent-x');
    expect(result).toBe('conv-active');
  });

  it('throws when sub-agent is not found', () => {
    const registry = makeRegistry([]);
    expect(() => resolveConvId(registry, 'unknown')).toThrow('unknown');
  });

  it('auto-creates conversation when active conv not found in list', () => {
    const newConv = { getState: vi.fn(() => ({ conversationId: 'conv-new' })) };
    const registry = {
      getState: vi.fn(() => ({
        subAgents: [{
          name: 'agent-x',
          activeConversationId: 'conv-stale',
          conversations: [],
        }],
      })),
      createConversation: vi.fn(() => newConv),
    } as any;

    const result = resolveConvId(registry, 'agent-x');
    expect(registry.createConversation).toHaveBeenCalledWith('agent-x');
    expect(result).toBe('conv-new');
  });
});
