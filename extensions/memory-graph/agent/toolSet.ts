import './types';

import type { ToolSet, ToolSetContext, CompactionResult } from '@agent-type';
import type { AgentMessage } from '@agent-type';
import type { SessionEntryData } from '@agent-type';
import type { KnowledgeGraph, KnowledgeNode, MemoryGraphToolSetOptions, MemoryGraphSymbolState } from './types';
import { MEMORY_GRAPH_SYMBOL } from './types';
import { memoryGraphStore, convKey } from './store';
import { createMemoryGraphTools } from './tools';
import { MEMORY_GRAPH_SECTION_ID } from './prompt';

// ── System prompt builder ─────────────────────────────────────────────────────

type BuildOptions = {
  maxNodes: number;
  maxDescriptionLength: number;
};

function truncateDescription(desc: string, maxLen: number): string {
  if (desc.length <= maxLen) return desc;
  return desc.slice(0, maxLen - 1) + '…';
}

function buildSystemPromptSection(graph: KnowledgeGraph, opts: BuildOptions): string {
  // Limit to the most recently added nodes (last N in insertion order)
  const nodes: KnowledgeNode[] =
    graph.nodes.length > opts.maxNodes
      ? graph.nodes.slice(-opts.maxNodes)
      : [...graph.nodes];

  const shownIds = new Set(nodes.map((n) => n.id));

  const nodeLines = nodes.map((n) => {
    const tagPart = n.tags?.length ? ` [${n.tags.join(', ')}]` : '';
    const desc = truncateDescription(n.description, opts.maxDescriptionLength);
    return `- **${n.label}** (id: \`${n.id}\`)${tagPart}: ${desc}`;
  });

  const parts: string[] = [
    '[Knowledge Graph — Background Context]',
    '',
    '**Nodes:**',
    ...nodeLines,
  ];

  // Only include edges whose both endpoints are in the shown node set
  const visibleEdges = graph.edges.filter(
    (e) => shownIds.has(e.from) && shownIds.has(e.to),
  );

  if (visibleEdges.length > 0) {
    const edgeLines = visibleEdges.map((e) => `- \`${e.from}\` → \`${e.to}\`: ${e.relation}`);
    parts.push('', '**Relationships:**', ...edgeLines);
  }

  if (graph.nodes.length > opts.maxNodes) {
    parts.push(
      '',
      `_Showing ${opts.maxNodes} of ${graph.nodes.length} nodes (most recent). Use memory_recall to search older entries._`,
    );
  } else {
    parts.push(
      '',
      '_This knowledge was extracted from earlier conversation turns that have been removed from context._',
    );
  }

  return parts.join('\n');
}

function pluralise(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create and return a MemoryGraph ToolSet.
 *
 * Provides four tools:
 * - `memory_history_list`  — list conversation turns
 * - `memory_distill`       — extract knowledge graph + prune turns from LLM context
 * - `memory_recall`        — search the graph
 * - `memory_graph_clear`   — wipe the graph
 *
 * The graph is scoped per conversation:
 * - Main agent session:       one graph per `sessionId`
 * - Sub-agent conversation:   one graph per `${sessionId}:${agentName}:${conversationId}`
 */
export function createMemoryGraphToolSet(options: MemoryGraphToolSetOptions = {}): ToolSet {
  const buildOpts: BuildOptions = {
    maxNodes: options.maxNodesInPrompt ?? 15,
    maxDescriptionLength: options.maxDescriptionLength ?? 150,
  };
  // Shared refs — lifetime tied to this ToolSet instance (i.e. this agent).
  const historyCache = new Map<string, readonly AgentMessage[]>();

  const tools = createMemoryGraphTools(memoryGraphStore, historyCache);

  return {
    name: 'memory-graph',
    symbol: MEMORY_GRAPH_SYMBOL,
    coreTools: ['memory_recall'],
    sectionId: MEMORY_GRAPH_SECTION_ID,
    sectionPriority: 70,
    tools,

    // ── Per-run hook ────────────────────────────────────────────────────────

    onBeforeRun(ctx: ToolSetContext, history: readonly AgentMessage[]): void {
      historyCache.set(convKey(ctx), history);
    },

    // ── Session lifecycle ───────────────────────────────────────────────────

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      const graph = (entryData as { memoryGraph?: KnowledgeGraph } | undefined)?.memoryGraph;
      if (graph) {
        memoryGraphStore.set(convKey(ctx), graph);
      }
    },

    onReset(ctx: ToolSetContext): void {
      const key = convKey(ctx);
      memoryGraphStore.reset(key);
      historyCache.delete(key);
    },

    onRemove(ctx: ToolSetContext): void {
      const key = convKey(ctx);
      memoryGraphStore.remove(key);
      historyCache.delete(key);
    },

    // ── State & UI subscription ─────────────────────────────────────────────

    onGetSymbolState(ctx: ToolSetContext): MemoryGraphSymbolState {
      const graph = memoryGraphStore.get(convKey(ctx)) ?? undefined;
      return {
        type: 'memory-graph',
        graph,
        memoryGraph: { graph },
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return memoryGraphStore.subscribe(convKey(ctx), fn);
    },

    // ── Snapshot serialisation ──────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext) {
      const graph = memoryGraphStore.serialize(convKey(ctx));
      return graph ? { memoryGraph: graph } : {};
    },

    // ── System prompt injection ─────────────────────────────────────────────

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const graph = memoryGraphStore.get(convKey(ctx));
      const guidance = '## Memory\nAfter completing a work phase: call memory_history_list then memory_distill to extract knowledge and free context window space.';
      if (!graph || graph.nodes.length === 0) return guidance;
      return `${guidance}\n\n${buildSystemPromptSection(graph, buildOpts)}`;
    },

    // ── Post-turn compaction ────────────────────────────────────────────────

    async onAfterTurn(
      ctx: ToolSetContext,
      history: AgentMessage[],
    ): Promise<CompactionResult | void> {
      const key = convKey(ctx);
      const pending = memoryGraphStore.getPending(key);
      memoryGraphStore.clearPending(key);

      if (!pending) return;

      // Prune only the selected turns from LLM-facing history.
      // fullHistory (the UI chat list) is never touched — the messages remain
      // visible to the user but are excluded from future LLM context.
      // Build a Set of all indices that belong to a selected turn so that
      // non-selected turns interleaved between selections are preserved.
      const removedIndices = new Set<number>();
      for (const r of pending.rawRanges) {
        for (let i = r.from; i <= r.to; i++) removedIndices.add(i);
      }
      const pruned: AgentMessage[] = history.filter((_, i) => !removedIndices.has(i));

      const turnCount = pending.turns.length;
      const messageCount = removedIndices.size;
      const current = memoryGraphStore.get(key) ?? pending.graph;

      const notice =
        `_${pluralise(turnCount, 'turn')} distilled ` +
        `(${pluralise(messageCount, 'message')} removed from context). ` +
        `Knowledge graph: ${pluralise(current.nodes.length, 'node')}, ` +
        `${pluralise(current.edges.length, 'edge')}._`;

      return {
        history: pruned,
        notices: [{ content: notice }],
      };
    },
  };
}
