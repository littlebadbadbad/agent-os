import { describe, it, expect, vi, afterEach } from 'vitest';
import { memoryGraphStore, mergeGraphs, convKey } from '../../tools/memoryGraph/store';
import { MAIN_CONVERSATION_ID } from '../../tools/toolSet';
import type { KnowledgeGraph } from '../../tools/memoryGraph/types';

function makeGraph(overrides?: Partial<KnowledgeGraph>): KnowledgeGraph {
  return {
    nodes: [{ id: 'n1', label: 'Node 1', description: 'First node' }],
    edges: [],
    updatedAt: new Date().toISOString(),
    updateCount: 1,
    ...overrides,
  };
}

describe('convKey', () => {
  it('returns sessionId for main conversation', () => {
    const key = convKey({ sessionId: 'sess-1', agentName: 'main', conversationId: MAIN_CONVERSATION_ID });
    expect(key).toBe('sess-1');
  });

  it('returns compound key for sub-agent conversation', () => {
    const key = convKey({ sessionId: 'sess-1', agentName: 'sub', conversationId: 'conv-1' });
    expect(key).toBe('sess-1:sub:conv-1');
  });
});

describe('mergeGraphs', () => {
  it('returns patch with updateCount=1 when base is null', () => {
    const patch = makeGraph({ nodes: [{ id: 'a', label: 'A', description: '' }] });
    const merged = mergeGraphs(null, patch);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.updateCount).toBe(1);
    expect(merged.updatedAt).toBeDefined();
  });

  it('deduplicates nodes by id (patch wins)', () => {
    const base = makeGraph({
      nodes: [{ id: 'n1', label: 'Old', description: 'Old desc' }],
      updateCount: 1,
    });
    const patch: KnowledgeGraph = {
      nodes: [{ id: 'n1', label: 'New', description: 'New desc' }],
      edges: [],
      updatedAt: new Date().toISOString(),
      updateCount: 1,
    };
    const merged = mergeGraphs(base, patch);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0].label).toBe('New');
  });

  it('merges distinct nodes from base and patch', () => {
    const base = makeGraph({
      nodes: [{ id: 'n1', label: 'A', description: '' }],
      updateCount: 1,
    });
    const patch: KnowledgeGraph = {
      nodes: [{ id: 'n2', label: 'B', description: '' }],
      edges: [],
      updatedAt: new Date().toISOString(),
      updateCount: 1,
    };
    const merged = mergeGraphs(base, patch);
    expect(merged.nodes).toHaveLength(2);
    expect(merged.updateCount).toBe(2);
  });

  it('deduplicates edges by from+to+relation triple', () => {
    const base = makeGraph({
      nodes: [{ id: 'a', label: 'A', description: '' }, { id: 'b', label: 'B', description: '' }],
      edges: [{ from: 'a', to: 'b', relation: 'connects_to' }],
      updateCount: 1,
    });
    const patch: KnowledgeGraph = {
      nodes: [{ id: 'a', label: 'A', description: '' }],
      edges: [{ from: 'a', to: 'b', relation: 'connects_to' }],
      updatedAt: new Date().toISOString(),
      updateCount: 1,
    };
    const merged = mergeGraphs(base, patch);
    expect(merged.edges).toHaveLength(1);
  });

  it('adds new edges from patch', () => {
    const base = makeGraph({
      nodes: [{ id: 'a', label: 'A', description: '' }, { id: 'b', label: 'B', description: '' }],
      updateCount: 1,
    });
    const patch: KnowledgeGraph = {
      nodes: [],
      edges: [{ from: 'a', to: 'b', relation: 'depends_on' }],
      updatedAt: new Date().toISOString(),
      updateCount: 1,
    };
    const merged = mergeGraphs(base, patch);
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0].relation).toBe('depends_on');
  });
});

describe('memoryGraphStore', () => {
  const key = 'test-key';

  afterEach(() => {
    memoryGraphStore.remove(key);
  });

  it('get returns null for unknown key', () => {
    expect(memoryGraphStore.get('unknown')).toBeNull();
  });

  it('set and get round-trips a graph', () => {
    const g = makeGraph();
    memoryGraphStore.set(key, g);
    expect(memoryGraphStore.get(key)).toEqual(g);
  });

  it('set overwrites existing graph', () => {
    const g1 = makeGraph({ nodes: [{ id: 'old', label: 'Old', description: '' }] });
    const g2 = makeGraph({ nodes: [{ id: 'new', label: 'New', description: '' }] });
    memoryGraphStore.set(key, g1);
    memoryGraphStore.set(key, g2);
    expect(memoryGraphStore.get(key)!.nodes[0].id).toBe('new');
  });

  it('getPending returns null when nothing pending', () => {
    expect(memoryGraphStore.getPending(key)).toBeNull();
  });

  it('setPending and getPending round-trips', () => {
    memoryGraphStore.setPending(key, {
      turns: [0, 1],
      rawRanges: [{ from: 0, to: 2 }],
      graph: makeGraph(),
    });
    const p = memoryGraphStore.getPending(key);
    expect(p).not.toBeNull();
    expect(p!.turns).toEqual([0, 1]);
  });

  it('clearPending removes the pending distillation', () => {
    memoryGraphStore.setPending(key, {
      turns: [0],
      rawRanges: [{ from: 0, to: 1 }],
      graph: makeGraph(),
    });
    memoryGraphStore.clearPending(key);
    expect(memoryGraphStore.getPending(key)).toBeNull();
  });

  it('clearPending is safe when nothing pending', () => {
    expect(() => memoryGraphStore.clearPending(key)).not.toThrow();
  });

  it('reset clears the graph and pending', () => {
    memoryGraphStore.set(key, makeGraph());
    memoryGraphStore.setPending(key, {
      turns: [0],
      rawRanges: [{ from: 0, to: 1 }],
      graph: makeGraph(),
    });
    memoryGraphStore.reset(key);
    expect(memoryGraphStore.get(key)).toBeNull();
    expect(memoryGraphStore.getPending(key)).toBeNull();
  });

  it('reset is safe for unknown key', () => {
    expect(() => memoryGraphStore.reset('unknown')).not.toThrow();
  });

  it('remove deletes the bucket', () => {
    memoryGraphStore.set(key, makeGraph());
    memoryGraphStore.remove(key);
    expect(memoryGraphStore.get(key)).toBeNull();
  });

  it('subscribe notifies on set', () => {
    const fn = vi.fn();
    memoryGraphStore.subscribe(key, fn);
    memoryGraphStore.set(key, makeGraph());
    expect(fn).toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe function', () => {
    const fn = vi.fn();
    const unsub = memoryGraphStore.subscribe(key, fn);
    unsub();
    memoryGraphStore.set(key, makeGraph());
    expect(fn).not.toHaveBeenCalled();
  });

  it('serialize returns the graph for an existing key', () => {
    const g = makeGraph();
    memoryGraphStore.set(key, g);
    expect(memoryGraphStore.serialize(key)).toEqual(g);
  });

  it('serialize returns null for unknown key', () => {
    expect(memoryGraphStore.serialize('unknown')).toBeNull();
  });

  it('notify triggers all subscribers', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    memoryGraphStore.subscribe(key, fn1);
    memoryGraphStore.subscribe(key, fn2);
    memoryGraphStore.notify(key);
    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });
});
