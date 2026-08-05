import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { ToolSetContext } from '@agent-type';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeEdge } from './types';

// ── Key helper ────────────────────────────────────────────────────────────────

/**
 * Derive a unique, stable string key for a conversation scope.
 *
 * - Main agent session:      `sessionId`
 * - Sub-agent conversation:  `"${sessionId}:${agentName}:${conversationId}"`
 *
 * Unlike `ctxKey`, this includes `conversationId` for sub-agents
 * so that each sub-agent conversation maintains its own isolated graph.
 */
export function convKey(ctx: {
  sessionId: string;
  agentName: string;
  conversationId: string;
}): string {
  return ctx.conversationId === MAIN_CONVERSATION_ID
    ? ctx.sessionId
    : `${ctx.sessionId}:${ctx.agentName}:${ctx.conversationId}`;
}

// ── Internal types ────────────────────────────────────────────────────────────

/**
 * A distillation scheduled by `memory_distill` during a tool call.
 * Consumed by `onAfterTurn` to atomically prune the selected messages from
 * the LLM context and emit a `CompactionResult`.
 */
export type MessageRange = {
  readonly from: number;
  readonly to: number;
};

export type PendingDistillation = {
  /** Original turn indices selected by the agent. */
  readonly turns: readonly number[];
  /**
   * Inclusive message-index ranges to remove, one per selected turn.
   * Using per-turn ranges (instead of a single from–to span) ensures that
   * only selected turns are pruned even when non-contiguous turns are chosen.
   */
  readonly rawRanges: readonly MessageRange[];
  /** Pre-computed graph extracted by the tool (already merged into store). */
  readonly graph: KnowledgeGraph;
};

type Bucket = {
  graph: KnowledgeGraph | null;
  pending: PendingDistillation | null;
  subs: Set<() => void>;
};

// ── Internal storage ──────────────────────────────────────────────────────────

const buckets = new Map<string, Bucket>();

function getOrCreate(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { graph: null, pending: null, subs: new Set() };
    buckets.set(key, b);
  }
  return b;
}

function notify(key: string): void {
  buckets.get(key)?.subs.forEach((fn) => fn());
}

// ── Graph merge ───────────────────────────────────────────────────────────────

/**
 * Merge `patch` into `base`, returning a new graph object.
 *
 * - Nodes are deduplicated by `id`; `patch` wins on conflicts.
 * - Edges are deduplicated by the `from + to + relation` triple; `patch` wins.
 * - `updateCount` is incremented; `updatedAt` is set to now.
 */
export function mergeGraphs(
  base: KnowledgeGraph | null,
  patch: KnowledgeGraph,
): KnowledgeGraph {
  if (!base) {
    return { ...patch, updateCount: 1, updatedAt: new Date().toISOString() };
  }

  const nodeMap = new Map<string, KnowledgeNode>();
  for (const n of base.nodes) nodeMap.set(n.id, n);
  for (const n of patch.nodes) nodeMap.set(n.id, n); // patch wins

  const edgeKey = (e: KnowledgeEdge) => `${e.from}\x00${e.to}\x00${e.relation}`;
  const edgeMap = new Map<string, KnowledgeEdge>();
  for (const e of base.edges) edgeMap.set(edgeKey(e), e);
  for (const e of patch.edges) edgeMap.set(edgeKey(e), e); // patch wins

  return {
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
    updatedAt: new Date().toISOString(),
    updateCount: base.updateCount + 1,
  };
}

// ── Store API ─────────────────────────────────────────────────────────────────

export const memoryGraphStore = {
  get(key: string): KnowledgeGraph | null {
    return buckets.get(key)?.graph ?? null;
  },

  set(key: string, graph: KnowledgeGraph): void {
    getOrCreate(key).graph = graph;
    notify(key);
  },

  getPending(key: string): PendingDistillation | null {
    return buckets.get(key)?.pending ?? null;
  },

  setPending(key: string, pending: PendingDistillation): void {
    getOrCreate(key).pending = pending;
  },

  clearPending(key: string): void {
    const b = buckets.get(key);
    if (b) b.pending = null;
  },

  reset(key: string): void {
    const b = buckets.get(key);
    if (b) {
      b.graph = null;
      b.pending = null;
      notify(key);
    }
  },

  remove(key: string): void {
    buckets.delete(key);
  },

  subscribe(key: string, fn: () => void): () => void {
    const b = getOrCreate(key);
    b.subs.add(fn);
    return () => b.subs.delete(fn);
  },

  notify,

  serialize(key: string): KnowledgeGraph | null {
    return buckets.get(key)?.graph ?? null;
  },
};
