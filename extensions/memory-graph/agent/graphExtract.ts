import type { AgentMessage, AgentStreamChunk } from '@agent-type';
import type { AgentHandler, HandlerContext } from '@agent-type';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeEdge } from './types';

// ── Extraction prompt ─────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `\
You are a knowledge extraction assistant.
Your sole task is to extract a structured knowledge graph from the conversation messages provided.

Return ONLY a valid JSON object with this exact schema — no prose, no markdown fences, no commentary:
{
  "nodes": [
    { "id": "unique-kebab-slug", "label": "Short Name", "description": "Rich description.", "tags": ["optional"] }
  ],
  "edges": [
    { "from": "node-id", "to": "node-id", "relation": "relationship_verb" }
  ]
}

Rules:
- Every node must have a unique, stable, lowercase kebab-case id (e.g. "user-auth-system").
- Capture entities, concepts, decisions, facts, people, tools, and their relationships.
- Edge relations should be concise verb phrases (e.g. "owns", "depends_on", "created_by").
- Omit the tags array entirely if not applicable.
- If there is nothing meaningful to extract, return: {"nodes":[],"edges":[]}`;

const EXTRACTION_REQUEST = 'Extract a knowledge graph from the conversation messages above. Return only JSON.';

// ── Stream / static response drain ───────────────────────────────────────────

async function collectText(
  result: Awaited<ReturnType<AgentHandler>>,
  signal: AbortSignal,
): Promise<string> {
  if (result && typeof result === 'object' && 'getReader' in result) {
    const stream = result as ReadableStream<AgentStreamChunk>;
    const reader = stream.getReader();
    const chunks: string[] = [];
    const onAbort = (): void => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'text') chunks.push(value.delta);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return chunks.join('');
  }
  if (result && typeof result === 'object' && 'text' in result) {
    return (result as { text: string }).text;
  }
  return String(result);
}

// ── JSON parsing ──────────────────────────────────────────────────────────────

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  // Try direct parse first
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  // Extract first {...} block (handles prose wrapping)
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error(
    `[memory-graph] Could not parse JSON from extraction response:\n${trimmed.slice(0, 300)}`,
  );
}

function parseGraphJson(raw: string): KnowledgeGraph {
  const obj = extractJsonObject(raw) as Record<string, unknown>;

  const rawNodes = Array.isArray(obj?.nodes) ? (obj.nodes as unknown[]) : [];
  const rawEdges = Array.isArray(obj?.edges) ? (obj.edges as unknown[]) : [];

  const nodes: KnowledgeNode[] = rawNodes
    .filter((n): n is Record<string, unknown> => typeof n === 'object' && n !== null)
    .filter((n) => typeof n.id === 'string' && n.id.trim().length > 0)
    .map((n) => {
      const node: KnowledgeNode = {
        id: String(n.id).trim(),
        label: typeof n.label === 'string' ? n.label : String(n.id),
        description: typeof n.description === 'string' ? n.description : '',
      };
      if (Array.isArray(n.tags) && n.tags.length > 0) {
        node.tags = (n.tags as unknown[]).map(String);
      }
      return node;
    });

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: KnowledgeEdge[] = rawEdges
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .filter(
      (e) =>
        typeof e.from === 'string' &&
        typeof e.to === 'string' &&
        typeof e.relation === 'string' &&
        nodeIds.has(e.from as string) &&
        nodeIds.has(e.to as string),
    )
    .map((e) => ({
      from: String(e.from),
      to: String(e.to),
      relation: String(e.relation),
    }));

  return {
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
    updateCount: 1,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Invoke the agent handler to extract a knowledge graph from a set of
 * conversation messages.
 *
 * Tools are disabled (`tools: [], toolChoice: 'none'`) to prevent recursive
 * tool use during extraction.  The system prompt instructs the model to return
 * only a JSON object matching the `KnowledgeGraph` schema.
 *
 * @param handler  The same `AgentHandler` driving the main conversation.
 * @param messages The messages to extract knowledge from.
 * @param signal   Abort signal forwarded from the calling tool execution.
 */
export async function callGraphExtractionHandler(
  handler: AgentHandler,
  messages: readonly AgentMessage[],
  signal: AbortSignal,
): Promise<KnowledgeGraph> {
  const context: HandlerContext = {
    tools: [],
    callTool: () => {
      throw new Error('[memory-graph] callTool: tools are disabled during graph extraction');
    },
    toolChoice: 'none',
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    signal,
  };

  // Append the extraction instruction after the selected conversation messages
  const request: AgentMessage[] = [
    ...messages,
    { role: 'user', content: EXTRACTION_REQUEST },
  ];

  const result = await handler(request, context);
  const text = await collectText(result, signal);
  return parseGraphJson(text);
}
