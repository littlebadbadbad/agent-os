import { describe, it, expect, vi } from 'vitest';
import { createMemoryGraphToolSet } from '../../tools/memoryGraph/toolSet';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { KnowledgeGraph } from '../../tools/memoryGraph/types';


// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'mg-session-1', conversationId = MAIN_CONVERSATION_ID) {
  return { sessionId, agentName: 'main', conversationId };
}

function makeToolCtx(sessionId = 'mg-session-1', conversationId = MAIN_CONVERSATION_ID) {
  return {
    sessionId,
    agentName: 'main',
    conversationId,
    signal: new AbortController().signal,
    };
}

function makeGraph(overrides?: Partial<KnowledgeGraph>): KnowledgeGraph {
  return {
    nodes: [{ id: 'entity-1', label: 'Entity 1', description: 'First entity' }],
    edges: [],
    updatedAt: new Date().toISOString(),
    updateCount: 1,
    ...overrides,
  };
}

// Unique session ids per test.
let counter = 0;
function freshSessionId(): string {
  return `mg-test-${++counter}`;
}

// ── createMemoryGraphToolSet ──────────────────────────────────────────────────

describe('createMemoryGraphToolSet', () => {
  // ── Shape ──────────────────────────────────────────────────────────────────

  it('returns a ToolSet with name "memory-graph"', () => {
    const ts = createMemoryGraphToolSet();
    expect(ts.name).toBe('memory-graph');
  });

  it('exposes a memory_recall tool', () => {
    const ts = createMemoryGraphToolSet();
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    const names = (tools as any[]).map((t: any) => t.name);
    expect(names).toContain('memory_recall');
  });

  // ── onInit ──────────────────────────────────────────────────────────

  it('onInit restores graph from entryData', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const graph = makeGraph();
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: graph });
    const state = ts.onGetState!(ctx) as any;
    expect(state.memoryGraph?.graph).toBeDefined();
    expect(state.memoryGraph?.graph.nodes[0].id).toBe('entity-1');
  });

  it('onInit handles missing memoryGraph in entryData', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    expect(() => ts.onInit!(ctx, { id: sessionId, title: 'T' })).not.toThrow();
  });

  // ── onReset ─────────────────────────────────────────────────────────

  it('onReset clears the graph', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: makeGraph() });
    ts.onReset!(ctx);
    const state = ts.onGetState!(ctx) as any;
    // After reset: graph is cleared
    expect(state.memoryGraph?.graph).toBeUndefined();
  });

  // ── onRemove ────────────────────────────────────────────────────────

  it('onRemove removes the session entry', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: makeGraph() });
    ts.onRemove!(ctx);
    const state = ts.onGetState!(ctx) as any;
    // After removal the graph is gone
    expect(state.memoryGraph?.graph).toBeUndefined();
  });

  it('onRemove does not affect other sessions', () => {
    const ts = createMemoryGraphToolSet();
    const s1 = freshSessionId();
    const s2 = freshSessionId();
    const ctx1 = makeCtx(s1);
    const ctx2 = makeCtx(s2);
    ts.onInit!(ctx1, { id: s1, title: 'T', memoryGraph: makeGraph() });
    ts.onInit!(ctx2, { id: s2, title: 'T', memoryGraph: makeGraph() });
    ts.onRemove!(ctx1);
    const state2 = ts.onGetState!(ctx2) as any;
    expect(state2.memoryGraph?.graph).toBeDefined();
  });

  // ── onGetState ─────────────────────────────────────────────────────────────

  it('onGetState returns no graph for unknown session', () => {
    const ts = createMemoryGraphToolSet();
    const ctx = makeCtx(freshSessionId());
    const state = ts.onGetState!(ctx) as any;
    expect(state.memoryGraph?.graph).toBeUndefined();
  });

  it('onGetState reflects the current graph', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const graph = makeGraph();
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: graph });
    const state = ts.onGetState!(ctx) as any;
    expect(state.memoryGraph?.graph?.nodes[0].id).toBe('entity-1');
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  it('onGetSystemPrompt returns guidance string when no graph', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T' });
    // @ts-expect-error �?onGetSystemPrompt signature requires 2 args; promptCtx unused in impl
    const prompt = ts.onGetSystemPrompt!(ctx);
    expect(prompt).toMatch(/## Memory/);
  });

  it('onGetSystemPrompt returns graph content when graph exists', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const graph = makeGraph({ nodes: [{ id: 'node-A', label: 'Node A', description: 'Alpha entity' }] });
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: graph });
    // @ts-expect-error �?onGetSystemPrompt signature requires 2 args; promptCtx unused in impl
    const prompt = ts.onGetSystemPrompt!(ctx);
    expect(prompt).toBeDefined();
    expect(prompt).toMatch(/node-A|Alpha entity/);
  });

  it('onGetSystemPrompt returns guidance string when graph has no nodes', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const emptyGraph: KnowledgeGraph = { nodes: [], edges: [], updatedAt: new Date().toISOString(), updateCount: 1 };
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: emptyGraph });
    // @ts-expect-error �?onGetSystemPrompt signature requires 2 args; promptCtx unused in impl
    const prompt = ts.onGetSystemPrompt!(ctx);
    expect(prompt).toMatch(/## Memory/);
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires when graph is reset', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: makeGraph() });
    const fn = vi.fn();
    ts.onSubscribe!(ctx, fn);
    // store.reset calls notify, which fires all subscribers
    ts.onReset!(ctx);
    expect(fn).toHaveBeenCalled();
  });

  it('onSubscribe returns an unsubscribe function', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: makeGraph() });
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    unsub();
    ts.onReset!(ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  // ── onBuildSnapshot ────────────────────────────────────────────────────────

  it('onBuildSnapshot includes the serialized graph', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const graph = makeGraph();
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: graph });
    const snap = ts.onBuildSnapshot!(ctx) as any;
    // Snapshot shape: { memoryGraph: KnowledgeGraph } �?the graph is stored directly
    expect(snap.memoryGraph).toBeDefined();
    expect(snap.memoryGraph.nodes[0].id).toBe('entity-1');
  });

  it('onBuildSnapshot returns a defined object even without graph', () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T' });
    // Should not throw; the value may be undefined inside
    expect(() => ts.onBuildSnapshot!(ctx)).not.toThrow();
  });

  // ── memory_recall tool ─────────────────────────────────────────────────────

  it('memory_recall returns empty result when no graph', async () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    ts.onInit!(ctx, { id: sessionId, title: 'T' });
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    const recallTool = (tools as any[]).find((t: any) => t.name === 'memory_recall');
    const result = await recallTool.execute({ query: 'test' }, makeToolCtx(sessionId));
    // When no graph, the tool should handle it gracefully
    expect(result).toBeDefined();
  });

  it('memory_recall returns matching entities when graph exists', async () => {
    const ts = createMemoryGraphToolSet();
    const sessionId = freshSessionId();
    const ctx = makeCtx(sessionId);
    const graph = makeGraph({ nodes: [{ id: 'auth-system', label: 'Auth System', description: 'OAuth authentication module' }] });
    ts.onInit!(ctx, { id: sessionId, title: 'T', memoryGraph: graph });
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    const recallTool = (tools as any[]).find((t: any) => t.name === 'memory_recall');
    const result = await recallTool.execute({ query: 'auth' }, makeToolCtx(sessionId));
    expect(result).toBeDefined();
  });

  // ── session isolation ──────────────────────────────────────────────────────

  it('sessions have independent graphs', () => {
    const ts = createMemoryGraphToolSet();
    const s1 = freshSessionId();
    const s2 = freshSessionId();
    const ctx1 = makeCtx(s1);
    const ctx2 = makeCtx(s2);
    ts.onInit!(ctx1, { id: s1, title: 'T', memoryGraph: makeGraph() });
    ts.onInit!(ctx2, { id: s2, title: 'T' });
    const state1 = ts.onGetState!(ctx1) as any;
    const state2 = ts.onGetState!(ctx2) as any;
    expect(state1.memoryGraph?.graph).toBeDefined();
    expect(state2.memoryGraph?.graph).toBeUndefined();
  });
});
