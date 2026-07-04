import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { MAIN_CONVERSATION_ID } from '@agent-sdk/tools/toolSet';
import type { AgentMessage } from '@agent-type';
import type { KnowledgeGraph } from './types';
import { memoryGraphStore, mergeGraphs, type PendingDistillation, type MessageRange } from './store';
import { callGraphExtractionHandler } from './graphExtract';

// ── Key helper ────────────────────────────────────────────────────────────────

function toolConvKey(context: {
  sessionId: string;
  agentName: string;
  conversationId: string;
}): string {
  return context.conversationId === MAIN_CONVERSATION_ID
    ? context.sessionId
    : `${context.sessionId}:${context.agentName}:${context.conversationId}`;
}

// ── Turn helpers ──────────────────────────────────────────────────────────────

type ConversationTurn = {
  turnIndex: number;
  fromIndex: number;
  toIndex: number;
  messageCount: number;
  /** First 120 chars of the user message. */
  preview: string;
};

/**
 * Group a flat `AgentMessage[]` into logical turns.
 * Each turn starts at a `UserMessage` and spans all subsequent messages
 * until the next `UserMessage` (exclusive).
 */
function computeTurns(history: readonly AgentMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'user') {
      if (current) turns.push(current);
      current = {
        turnIndex: turns.length,
        fromIndex: i,
        toIndex: i,
        messageCount: 1,
        preview: msg.content.slice(0, 120),
      };
    } else if (current) {
      current.toIndex = i;
      current.messageCount++;
    }
  }
  if (current) turns.push(current);
  return turns;
}

function formatTurns(turns: ConversationTurn[]): string {
  if (turns.length === 0) return 'No conversation turns yet.';
  return turns
    .map(
      (t) =>
        `Turn ${t.turnIndex} [${t.messageCount} msg${t.messageCount !== 1 ? 's' : ''}]: ` +
        `"${t.preview.replace(/\n/g, ' ')}${t.preview.length === 120 ? '…' : ''}"`,
    )
    .join('\n');
}

function pluralise(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * Create the four memory-graph tools, closed over shared mutable refs.
 *
 * @param store        The module-level `memoryGraphStore`.
 * @param historyCache Map<convKey, history> populated by `onBeforeRun`.
 */
export function createMemoryGraphTools(
  store: typeof memoryGraphStore,
  historyCache: Map<string, readonly AgentMessage[]>,
) {
  // ── memory_history_list ─────────────────────────────────────────────────────

  const memoryHistoryList = defineTool({
    name: 'memory_history_list',
    group: 'Memory Graph',
    description:
      'List all conversation turns in the current context window, with their index and a ' +
      'message preview. Use this before calling memory_distill to identify which turns to select.',
    parameters: z.object({}),
    execute: async (_, context) => {
      const key = toolConvKey(context);
      const history = historyCache.get(key) ?? [];
      const turns = computeTurns(history);
      return {
        turnCount: turns.length,
        turns: formatTurns(turns),
      };
    },
  });

  // ── memory_distill ──────────────────────────────────────────────────────────

  const memoryDistill = defineTool({
    name: 'memory_distill',
    group: 'Memory Graph',
    description:
      'Distill selected turns into the knowledge graph and remove them from LLM context (visible in UI). ' +
      'Calls the handler to extract nodes/edges. Replaces any pending prune scheduled in this response. ' +
      'Call memory_history_list first to see available turn indices.',
    parameters: z.object({
      turns: z
        .array(z.number().int().min(0))
        .min(1)
        .describe('Turn indices to distill (from memory_history_list). E.g. [0, 1, 2].'),
      hint: z
        .string()
        .optional()
        .describe(
          'Optional focus hint for the extraction model, e.g. "focus on technical decisions".',
        ),
    }),
    execute: async ({ turns, hint }, context) => {
      const handler = context.handler;
      if (!handler) {
        return '[memory_distill] Handler not available — tool was invoked outside a real pipeline.';
      }

      const key = toolConvKey(context);
      const history = historyCache.get(key) ?? [];
      const allTurns = computeTurns(history);

      // Validate indices
      const invalid = turns.filter((i) => i >= allTurns.length || i < 0);
      if (invalid.length > 0) {
        return (
          `[memory_distill] Invalid turn ${invalid.length > 1 ? 'indices' : 'index'}: ` +
          `${invalid.join(', ')}. Valid range: 0–${allTurns.length - 1}. ` +
          'Call memory_history_list to see available turns.'
        );
      }

      const sortedIndices = [...new Set(turns)].sort((a, b) => a - b);
      const selectedTurns = sortedIndices.map((i) => allTurns[i]);

      // Collect only the messages that belong to the explicitly selected turns.
      // Using per-turn ranges avoids accidentally pruning interleaved turns that
      // were not selected (e.g. selecting [0, 2] must not delete turn 1).
      const rawRanges: MessageRange[] = selectedTurns.map((t) => ({
        from: t.fromIndex,
        to: t.toIndex,
      }));
      const selectedMessages: AgentMessage[] = rawRanges.flatMap((r) =>
        history.slice(r.from, r.to + 1),
      );

      // Optionally append a focus hint as a final user message
      const extractionMessages: readonly AgentMessage[] = hint
        ? [
            ...selectedMessages,
            { role: 'user' as const, content: `Extraction hint: ${hint}` },
          ]
        : selectedMessages;

      let newGraph: KnowledgeGraph;
      try {
        newGraph = await callGraphExtractionHandler(handler, extractionMessages, context.signal);
      } catch (err) {
        if (context.signal.aborted) return '[memory_distill] Cancelled.';
        return `[memory_distill] Extraction failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (context.signal.aborted) return '[memory_distill] Cancelled.';

      // Merge into existing graph and persist
      const existing = store.get(key);
      const merged = mergeGraphs(existing, newGraph);
      store.set(key, merged);

      // Schedule the context prune for onAfterTurn
      const pending: PendingDistillation = {
        turns: sortedIndices,
        rawRanges,
        graph: newGraph,
      };
      store.setPending(key, pending);

      const totalMessages = rawRanges.reduce((sum, r) => sum + (r.to - r.from + 1), 0);
      const nodeLines =
        newGraph.nodes.length > 0
          ? '\n\nExtracted nodes:\n' +
            newGraph.nodes
              .map((n) => `• **${n.label}** (\`${n.id}\`): ${n.description}`)
              .join('\n')
          : '';

      return (
        `Knowledge graph updated — ` +
        `${pluralise(newGraph.nodes.length, 'node')} and ${pluralise(newGraph.edges.length, 'edge')} extracted. ` +
        `Total graph: ${pluralise(merged.nodes.length, 'node')}, ${pluralise(merged.edges.length, 'edge')}. ` +
        `${pluralise(sortedIndices.length, 'turn')} (${pluralise(totalMessages, 'message')}) ` +
        `will be removed from context after this response.` +
        nodeLines
      );
    },
  });

  // ── memory_recall ───────────────────────────────────────────────────────────

  const memoryRecall = defineTool({
    name: 'memory_recall',
    group: 'Memory Graph',
    description:
      'Search the knowledge graph for nodes and edges matching a query string. ' +
      'Searches node labels, descriptions, and tags (case-insensitive substring match). ' +
      'Returns matching nodes and all edges that connect them.',
    parameters: z.object({
      query: z.string().min(1).describe('Search query. Case-insensitive substring match.'),
    }),
    execute: async ({ query }, context) => {
      const key = toolConvKey(context);
      const graph = store.get(key);
      if (!graph || graph.nodes.length === 0) {
        return { message: 'No knowledge graph available yet. Use memory_distill to build one.' };
      }

      const q = query.toLowerCase();
      const matchedNodes = graph.nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.description.toLowerCase().includes(q) ||
          n.tags?.some((t) => t.toLowerCase().includes(q)),
      );

      if (matchedNodes.length === 0) {
        return { message: `No nodes found matching "${query}".`, totalNodes: graph.nodes.length };
      }

      const matchedIds = new Set(matchedNodes.map((n) => n.id));
      const relatedEdges = graph.edges.filter(
        (e) => matchedIds.has(e.from) || matchedIds.has(e.to),
      );

      return {
        nodes: matchedNodes.slice(0, 20),
        edges: relatedEdges.slice(0, 40),
        totalMatches: matchedNodes.length,
        truncated: matchedNodes.length > 20,
      };
    },
  });

  // ── memory_graph_clear ──────────────────────────────────────────────────────

  const memoryGraphClear = defineTool({
    name: 'memory_graph_clear',
    group: 'Memory Graph',
    description:
      'Clear the knowledge graph for the current conversation scope. ' +
      'All nodes and edges are removed from memory. ' +
      'Previously distilled conversation turns remain pruned from the LLM context ' +
      '(this operation does not restore them).',
    parameters: z.object({}),
    execute: async (_, context) => {
      store.reset(toolConvKey(context));
      return { success: true, message: 'Knowledge graph cleared.' };
    },
  });

  return [memoryHistoryList, memoryDistill, memoryRecall, memoryGraphClear] as const;
}
