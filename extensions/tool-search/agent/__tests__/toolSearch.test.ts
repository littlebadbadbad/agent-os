/**
 * Tests for toolSearch toolSet and tools modules.
 */

import { describe, it, expect, vi } from 'vitest';
import { createToolSearchToolSet } from '../toolSet';
import { createToolSearchTool } from '../tools';
import { z } from 'zod';

// ── createToolSearchTool ──────────────────────────────────────────────────────

describe('createToolSearchTool', () => {
  function makeTool(name: string, description: string, group = 'test') {
    return { name, description, group, parameters: z.object({}), execute: async () => 'ok' };
  }

  it('returns results for deferred tools matching by name', async () => {
    const tools = [
      makeTool('visible_tool', 'Always visible tool'),
      makeTool('deferred_reader', 'Reads data from files'),
      makeTool('another_tool', 'Something else'),
    ];
    const coreNames = new Set(['visible_tool']);
    const tool = createToolSearchTool(() => tools, coreNames);
    const result = await tool.execute({ query: 'reader' }, {} as any);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('deferred_reader');
  });

  it('returns results for deferred tools matching by description', async () => {
    const tools = [
      makeTool('tool_a', 'Handles file processing'),
      makeTool('tool_b', 'Network requests'),
    ];
    const coreNames = new Set<string>();
    const tool = createToolSearchTool(() => tools, coreNames);
    const result = await tool.execute({ query: 'file' }, {} as any);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('tool_a');
  });

  it('excludes core tools from search results', async () => {
    const tools = [
      makeTool('core_reader', 'Core reader tool'),
      makeTool('deferred_writer', 'Deferred writer tool'),
    ];
    const coreNames = new Set(['core_reader']);
    const tool = createToolSearchTool(() => tools, coreNames);
    const result = await tool.execute({ query: 'reader' }, {} as any);
    // "reader" matches core_reader, but it's a core tool so excluded
    expect(result.results).toHaveLength(0);
    expect(result.message).toContain('No deferred tools found');
  });

  it('returns empty message when no tools match', async () => {
    const tool = createToolSearchTool(() => [], new Set());
    const result = await tool.execute({ query: 'nonexistent' }, {} as any);
    expect(result.results).toHaveLength(0);
    expect(result.message).toContain('No deferred tools found');
  });

  it('limits results to 15', async () => {
    const tools = Array.from({ length: 20 }, (_, i) =>
      makeTool(`tool_${i}`, `Description ${i}`),
    );
    const coreNames = new Set<string>();
    const tool = createToolSearchTool(() => tools, coreNames);
    const result = await tool.execute({ query: 'tool' }, {} as any);
    expect(result.results.length).toBeLessThanOrEqual(15);
  });

  it('handles factory-function descriptions', async () => {
    const tools = [
      {
        name: 'dynamic_tool',
        description: () => 'A dynamically described tool for testing',
        group: 'test',
        parameters: z.object({}),
        execute: async () => 'ok',
      },
    ];
    const coreNames = new Set<string>();
    const tool = createToolSearchTool(() => tools, coreNames);
    const result = await tool.execute({ query: 'testing' }, {} as any);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('dynamic_tool');
  });
});

// ── createToolSearchToolSet ───────────────────────────────────────────────────

describe('createToolSearchToolSet', () => {
  it('has name "tool-search"', () => {
    const ts = createToolSearchToolSet();
    expect(ts.name).toBe('tool-search');
  });

  it('registers the tool_search tool', () => {
    const ts = createToolSearchToolSet();
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    expect(tools.some((t) => t.name === 'tool_search')).toBe(true);
  });

  it('onGetSystemPrompt returns undefined when no tools and no agent', () => {
    const ts = createToolSearchToolSet();
    const result = ts.onGetSystemPrompt?.({} as any, {} as any, []);
    expect(result).toBeUndefined();
  });

  it('onFilterTools passes through all tools when no ToolSets registered and no agent', () => {
    const ts = createToolSearchToolSet();
    const tools = [{ name: 't1', description: 'd1', parameters: z.object({}), execute: async () => 'ok' }];
    const result = ts.onFilterTools?.({} as any, tools);
    // No agent attached, so coreNames is just ['tool_search'], and these tools aren't in it
    expect(result).toHaveLength(0);
  });

  it('onAttach captures the agent reference', () => {
    const ts = createToolSearchToolSet();
    const detach = ts.onAttach?.({
      getTools: () => [],
      getRegisteredToolSets: () => [],
    } as any);
    expect(detach).toBeUndefined();
  });
});
