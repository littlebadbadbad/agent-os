import { describe, it, expect, vi } from 'vitest';
import { callGraphExtractionHandler } from '../graphExtract';
import type { AgentHandler, AgentMessage, AgentTurnResponse } from '@agent-type';

describe('callGraphExtractionHandler', () => {
  it('extracts a valid knowledge graph from a handler response with text', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [{ id: 'entity-1', label: 'Entity 1', description: 'The first entity' }],
        edges: [],
      }),
    } as AgentTurnResponse);

    const messages: AgentMessage[] = [
      { role: 'user', content: 'We built a system.' },
      { role: 'assistant', content: 'The system has Entity 1.' },
    ];

    const graph = await callGraphExtractionHandler(handler, messages, new AbortController().signal);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('entity-1');
    expect(graph.nodes[0].label).toBe('Entity 1');
    expect(graph.edges).toHaveLength(0);
    expect(graph.updateCount).toBe(1);
    expect(graph.updatedAt).toBeDefined();
  });

  it('returns empty graph when handler returns empty JSON', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({ nodes: [], edges: [] }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [], new AbortController().signal);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('extracts edges between nodes', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [
          { id: 'a', label: 'A', description: 'Entity A' },
          { id: 'b', label: 'B', description: 'Entity B' },
        ],
        edges: [{ from: 'a', to: 'b', relation: 'connects_to' }],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'A connects to B.' },
    ], new AbortController().signal);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('a');
    expect(graph.edges[0].to).toBe('b');
    expect(graph.edges[0].relation).toBe('connects_to');
  });

  it('filters out edges referencing unknown node ids', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [{ id: 'a', label: 'A', description: '' }],
        edges: [
          { from: 'a', to: 'missing', relation: 'refs' },
        ],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    expect(graph.edges).toHaveLength(0);
  });

  it('extracts tags when present', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [{ id: 'n1', label: 'N1', description: 'Test', tags: ['important', 'bug'] }],
        edges: [],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    expect(graph.nodes[0].tags).toEqual(['important', 'bug']);
  });

  it('omits tags when tags array is empty', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [{ id: 'n1', label: 'N1', description: 'Test', tags: [] }],
        edges: [],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    // Tags should not be set when empty
    expect(graph.nodes[0].tags).toBeUndefined();
  });

  it('handles JSON wrapped in markdown code fences', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: 'Here is the graph:\n```json\n{"nodes":[{"id":"x","label":"X","description":"Desc"}],"edges":[]}\n```',
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('x');
  });

  it('strips tags field entirely when omitted', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [{ id: 'n1', label: 'N1', description: 'No tags' }],
        edges: [],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    expect(graph.nodes[0].tags).toBeUndefined();
  });

  it('throws when JSON is completely unparseable', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: 'This is not JSON at all',
    } as AgentTurnResponse);

    await expect(
      callGraphExtractionHandler(handler, [{ role: 'user', content: 'test' }], new AbortController().signal)
    ).rejects.toThrow(/memory-graph/);
  });

  it('creates a timestamp on each call', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({ nodes: [{ id: 'a', label: 'A', description: '' }], edges: [] }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [{ role: 'user', content: 'test' }], new AbortController().signal);
    expect(graph.updatedAt).toBeDefined();
    expect(typeof graph.updatedAt).toBe('string');
  });

  it('uses label as fallback when label is missing', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [{ id: 'entity-42', description: 'Just an entity' }],
        edges: [],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    expect(graph.nodes[0].label).toBe('entity-42');
  });

  it('filters out nodes without a valid id', async () => {
    const handler: AgentHandler = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        nodes: [
          { id: 'valid', label: 'Valid', description: '' },
          { id: '', label: 'Empty', description: '' },
          { label: 'No id', description: '' },
        ],
        edges: [],
      }),
    } as AgentTurnResponse);

    const graph = await callGraphExtractionHandler(handler, [
      { role: 'user', content: 'test' },
    ], new AbortController().signal);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('valid');
  });

  it('passes system prompt and toolChoice:none to handler', async () => {
    const handler = vi.fn().mockResolvedValue({
      text: JSON.stringify({ nodes: [], edges: [] }),
    } as AgentTurnResponse);

    await callGraphExtractionHandler(handler, [{ role: 'user', content: 'hi' }], new AbortController().signal);

    expect(handler).toHaveBeenCalledOnce();
    const [, context] = handler.mock.calls[0];
    expect(context.toolChoice).toBe('none');
    expect(context.tools).toEqual([]);
    expect(context.systemPrompt).toContain('knowledge extraction');
  });
});
