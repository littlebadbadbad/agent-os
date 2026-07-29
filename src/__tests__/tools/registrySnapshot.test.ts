/**
 * Unit tests for `registrySnapshot.ts` — sub-agent registry snapshot builders.
 *
 * Tests collectToolSetState, collectToolSetSymbolState, snapshotConversation,
 * and snapshotEntry in isolation using a mock ToolSetScope.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolSetScope } from '../../tools/toolSetScope';
import type { ToolSetContext } from '@agent-type';
import type { ConversationHandle } from '../../tools/subagent/registryConversation';
import type { InternalEntry } from '../../tools/subagent/registryInternal';

// Module under test
import {
  collectToolSetState,
  collectToolSetSymbolState,
  snapshotConversation,
  snapshotEntry,
} from '../../tools/subagent/registrySnapshot';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SYM_A = Symbol('plugin-a');
const SYM_B = Symbol('plugin-b');

function makeScope(overrides?: Partial<ToolSetScope>): ToolSetScope {
  return {
    initScope: vi.fn(),
    readyScope: vi.fn(),
    resetScope: vi.fn(),
    removeScope: vi.fn(),
    subscribeScope: vi.fn(() => vi.fn()),
    beforeRun: vi.fn(),
    afterRun: vi.fn(),
    interceptMessage: vi.fn(() => false),
    beforeInvoke: vi.fn(() => []),
    buildSystemPrompt: vi.fn(() => 'prompt'),
    filterTools: vi.fn((t) => t),
    composeAfterTurn: vi.fn(),
    createPipeline: vi.fn() as any,
    collectState: vi.fn(() => ({ visible: true, [SYM_A]: { slot: 'data-a' }, [SYM_B]: { slot: 'data-b' } })),
    collectSnapshot: vi.fn(() => ({ snapKey: 'snap-value' })),
  } as any;
}

function makeSubCtx(_agentName: string, _convId: string): ToolSetContext {
  return { sessionId: 'sess-1', agentName: _agentName, conversationId: _convId };
}

function makeConvHandle(overrides?: Partial<ConversationHandle>): ConversationHandle {
  const state = {
    id: 'conv-1',
    agentName: 'agent-x',
    title: 'Test Conv',
    subtitle: '',
    updatedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    isLoading: false,
    streamingText: '',
    tracker: { getLiveHistory: vi.fn(() => []), getFullHistory: vi.fn(() => []) } as any,
    msgList: { messages: [] } as any,
  };
  return {
    _state: state,
    _notify: vi.fn(),
    _notifyRegistry: vi.fn(),
    getState: vi.fn(() => ({
      id: 'sess-1',
      agentName: 'agent-x',
      conversationId: 'conv-1',
      title: 'Test Conv',
      subtitle: '',
      updatedAt: '2025-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      isLoading: false,
      streamingText: '',
      history: [],
      messages: [],
    })),
    subscribe: vi.fn(() => vi.fn()),
    getHistory: vi.fn(() => []),
    setSubtitle: vi.fn(),
    ...overrides,
  } as unknown as ConversationHandle;
}

function makeEntry(overrides?: Partial<InternalEntry>): InternalEntry {
  return {
    name: 'agent-x',
    description: 'An agent',
    systemPrompt: 'You are helpful.',
    toolNames: ['tool_a', 'tool_b'],
    maxTurns: 10,
    parent: 'main:main',
    createdAt: '2025-01-01T00:00:00.000Z',
    activeConversationId: 'conv-1',
    conversations: new Map(),
    ...overrides,
  };
}

function makeResolveTools() {
  return vi.fn((names: readonly string[]) =>
    names.map((n) => ({ name: n, description: '', parameters: {} as any, execute: async () => {} })),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('collectToolSetState', () => {
  it('returns scope.collectState result as plain record', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const ctx = makeSubCtx('agent-x', 'conv-1');

    const result = collectToolSetState(resolveTools, ['tool_a'], scope, ctx);

    expect(result).toEqual({ visible: true, [SYM_A]: { slot: 'data-a' }, [SYM_B]: { slot: 'data-b' } });
  });

  it('passes correct ToolSetStateContext with resolved tools', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const ctx = makeSubCtx('agent-x', 'conv-1');
    const collectStateSpy = vi.fn(() => ({}));
    scope.collectState = collectStateSpy;

    collectToolSetState(resolveTools, ['tool_a', 'tool_b'], scope, ctx);

    expect(collectStateSpy).toHaveBeenCalledOnce();
    const stateCtx = (collectStateSpy.mock.calls[0] as any)[1];
    expect(stateCtx.tools).toHaveLength(2);
    expect(stateCtx.tools[0].name).toBe('tool_a');
    expect(stateCtx.tools[1].name).toBe('tool_b');
  });
});

describe('collectToolSetSymbolState', () => {
  it('returns only symbol-keyed state from scope.collectState', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const ctx = makeSubCtx('agent-x', 'conv-1');

    const result = collectToolSetSymbolState(resolveTools, ['tool_a'], scope, ctx);

    expect(result[SYM_A]).toEqual({ slot: 'data-a' });
    expect(result[SYM_B]).toEqual({ slot: 'data-b' });
  });

  it('returns empty object when no symbols are present', () => {
    const scope = makeScope();
    scope.collectState = vi.fn(() => ({ visible: true }));
    const resolveTools = makeResolveTools();
    const ctx = makeSubCtx('agent-x', 'conv-1');

    const result = collectToolSetSymbolState(resolveTools, ['tool_a'], scope, ctx);

    expect(result).toEqual({});
  });
});

describe('snapshotConversation', () => {
  it('returns SubAgentConversationState with merged ToolSet state', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const conv = makeConvHandle();
    const entry = makeEntry();

    const result = snapshotConversation(makeSubCtx, resolveTools, scope, conv, entry);

    expect(result.id).toBe('sess-1');
    expect(result.agentName).toBe('agent-x');
    expect(result.conversationId).toBe('conv-1');
    expect(result.title).toBe('Test Conv');
    expect((result as any).visible).toBe(true);
    expect(result[SYM_A]).toEqual({ slot: 'data-a' });
  });
});

describe('snapshotEntry', () => {
  it('returns SubAgentEntrySnapshot with conversations and ToolSet state', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const conv = makeConvHandle();
    const entry = makeEntry({ conversations: new Map([['conv-1', conv]]) });

    const result = snapshotEntry(makeSubCtx, resolveTools, scope, entry);

    expect(result.name).toBe('agent-x');
    expect(result.description).toBe('An agent');
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(result.toolNames).toEqual(['tool_a', 'tool_b']);
    expect(result.maxTurns).toBe(10);
    expect(result.parent).toBe('main:main');
    expect(result.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(result.activeConversationId).toBe('conv-1');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].conversationId).toBe('conv-1');
    expect((result as any).visible).toBe(true);
  });

  it('returns empty conversations list when none exist', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const entry = makeEntry({ conversations: new Map() });

    const result = snapshotEntry(makeSubCtx, resolveTools, scope, entry);

    expect(result.conversations).toEqual([]);
  });

  it('includes ToolSet symbol state on the entry', () => {
    const scope = makeScope();
    const resolveTools = makeResolveTools();
    const entry = makeEntry();

    const result = snapshotEntry(makeSubCtx, resolveTools, scope, entry);

    expect(result[SYM_A]).toEqual({ slot: 'data-a' });
    expect(result[SYM_B]).toEqual({ slot: 'data-b' });
  });
});
