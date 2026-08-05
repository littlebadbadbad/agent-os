// @ts-nocheck
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolStateToolSet } from '../agent';
import { createToolSearchTool, TOOL_SEARCH_THRESHOLD } from '../agent/tools';
import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { Tool, ToolExecutionContext, ToolSet, AgentQueryFns } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(sessionId = 'session-1', agentName = 'main', conversationId = MAIN_CONVERSATION_ID) {
  return { sessionId, agentName, conversationId };
}

function makeExecCtx(sessionId = 'session-1', agentName = 'main', conversationId = MAIN_CONVERSATION_ID): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    sessionId,
    agentName,
    conversationId,
    sourceAgent: agentName,
    isSubAgent: agentName !== 'main',
    toolCallId: 'call_00_test123',
  };
}

function makeTool(name: string, description?: string, group?: string): Tool {
  return {
    name,
    description: description ?? `tool ${name}`,
    parameters: z.object({}),
    group,
    execute: async () => null,
  };
}

// ── createToolSearchTool ──────────────────────────────────────────────────────

describe('createToolSearchTool', () => {
  it('returns top match for deferred tools matching by name', async () => {
    const tools = [
      makeTool('visible_tool', 'Always visible'),
      makeTool('deferred_reader', 'Reads data from files'),
      makeTool('another_tool', 'Something else'),
    ];
    const tool = createToolSearchTool(
      () => tools,
      () => new Set(['visible_tool']),
      () => new Set(),
    );
    const result = await tool.execute({ query: 'reader' }, makeExecCtx());
    expect(result.top).not.toBeNull();
    expect(result.top!.name).toBe('deferred_reader');
    expect(result.total).toBe(1);
    expect(result.others).toHaveLength(0);
  });

  it('returns top match with full description and parameters schema', async () => {
    const tools = [
      makeTool('file_reader', 'Reads and parses files from the filesystem. Supports text, JSON, and binary formats.'),
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'file' }, makeExecCtx());
    expect(result.top).not.toBeNull();
    expect(result.top!.name).toBe('file_reader');
    expect(result.top!.description).toBe(
      'Reads and parses files from the filesystem. Supports text, JSON, and binary formats.',
    );
    expect(result.top!.parameters).toBeDefined();
    expect(typeof result.top!.parameters).toBe('object');
    // Should have JSON Schema properties (type, properties, additionalProperties)
    expect(result.top!.parameters).toHaveProperty('type', 'object');
    expect(result.top!.parameters).toHaveProperty('properties');
  });

  it('returns results matching by description', async () => {
    const tools = [
      makeTool('tool_a', 'Handles file processing'),
      makeTool('tool_b', 'Network requests'),
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'file' }, makeExecCtx());
    expect(result.top).not.toBeNull();
    expect(result.top!.name).toBe('tool_a');
    expect(result.total).toBe(1);
  });

  it('supports multiple space-separated keywords', async () => {
    const tools = [
      makeTool('git_commit', 'Creates a git commit'),
      makeTool('file_read', 'Reads a file from disk'),
      makeTool('git_diff', 'Shows git diff'),
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'git file' }, makeExecCtx());
    // git_commit matches "git"; file_read matches "file" — the one matching more keywords ranks higher
    expect(result.top).not.toBeNull();
    // Both match one keyword, but name match scores higher... let's verify
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('ranks results by relevance score', async () => {
    const tools = [
      makeTool('file_reader', 'Some utility tool'),
      makeTool('file_writer', 'Writes files to disk'),
      makeTool('read_config', 'Reads configuration'),
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'file read' }, makeExecCtx());
    expect(result.top).not.toBeNull();
    // file_reader matches both "file" AND "read" — should rank highest
    expect(result.top!.name).toBe('file_reader');
    expect(result.top!.score).toBeGreaterThan(0);
  });

  it('excludes core tools from search results', async () => {
    const tools = [
      makeTool('core_reader', 'Core reader'),
      makeTool('deferred_writer', 'Deferred writer'),
    ];
    const tool = createToolSearchTool(
      () => tools,
      () => new Set(['core_reader']),
      () => new Set(),
    );
    const result = await tool.execute({ query: 'reader' }, makeExecCtx());
    expect(result.total).toBe(0);
    expect(result.top).toBeNull();
  });

  it('excludes disabled tools from search results', async () => {
    const tools = [
      makeTool('disabled_tool', 'A disabled tool'),
      makeTool('enabled_tool', 'An enabled tool'),
    ];
    const tool = createToolSearchTool(
      () => tools,
      () => new Set(),
      (key: string) => new Set(['disabled_tool']),
    );
    const result = await tool.execute({ query: 'tool' }, makeExecCtx());
    expect(result.total).toBe(1);
    expect(result.top!.name).toBe('enabled_tool');
  });

  it('returns empty when no tools match', async () => {
    const tool = createToolSearchTool(() => [], () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'nonexistent' }, makeExecCtx());
    expect(result.total).toBe(0);
    expect(result.top).toBeNull();
    expect(result.others).toHaveLength(0);
  });

  it('limits results to 15', async () => {
    const tools = Array.from({ length: 20 }, (_, i) => makeTool(`tool_${i}`, `Description ${i}`));
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'tool' }, makeExecCtx());
    expect(result.total).toBeLessThanOrEqual(15);
  });

  it('handles factory-function descriptions', async () => {
    const tools = [
      {
        name: 'dynamic_tool',
        description: () => 'A dynamically described tool for testing features',
        group: 'test',
        parameters: z.object({ input: z.string() }),
        execute: async () => 'ok',
      },
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'testing' }, makeExecCtx());
    expect(result.total).toBe(1);
    expect(result.top!.name).toBe('dynamic_tool');
    expect(result.top!.description).toContain('dynamically described');
  });

  it('uses per-scope disabled names via context', async () => {
    const tools = [makeTool('t1'), makeTool('t2')];
    const disabledByScope = new Map<string, Set<string>>();
    disabledByScope.set('session-s1', new Set(['t1']));

    const tool = createToolSearchTool(
      () => tools,
      () => new Set(),
      (key: string) => disabledByScope.get(key) ?? new Set(),
    );
    const result = await tool.execute({ query: 't' }, makeExecCtx('session-s1'));
    expect(result.total).toBe(1);
    expect(result.top!.name).toBe('t2');
  });

  it('handles tools with rawParametersSchema', async () => {
    const rawSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
    const tools: Tool[] = [
      {
        name: 'read_raw',
        description: 'Read using raw schema',
        parameters: () => z.object({}),
        rawParametersSchema: rawSchema,
        execute: async () => null,
      },
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'read' }, makeExecCtx());
    expect(result.top).not.toBeNull();
    expect(result.top!.parameters).toEqual(rawSchema);
  });

  it('others list contains secondary matches with name and description', async () => {
    const tools = [
      makeTool('tool_a', 'Primary match for testing'),
      makeTool('tool_b', 'Secondary match also for testing'),
      makeTool('tool_c', 'Third match for testing purposes'),
    ];
    const tool = createToolSearchTool(() => tools, () => new Set(), () => new Set());
    const result = await tool.execute({ query: 'testing' }, makeExecCtx());
    expect(result.total).toBe(3);
    expect(result.top).not.toBeNull();
    expect(result.others).toHaveLength(2);
    expect(result.others[0].name).toBeDefined();
    expect(result.others[0].description).toBeDefined();
    expect(result.others[0].score).toBeGreaterThan(0);
  });
});

// ── createToolStateToolSet ────────────────────────────────────────────────────

describe('createToolStateToolSet', () => {
  // ── Shape ──────────────────────────────────────────────────────────────────

  it('has name "ToolState"', () => {
    const ts = createToolStateToolSet();
    expect(ts.name).toBe('ToolState');
  });

  it('registers the tool_search tool', () => {
    const ts = createToolStateToolSet();
    const tools = typeof ts.tools === 'function' ? ts.tools() : ts.tools;
    expect(tools.some((t) => t.name === 'tool_search')).toBe(true);
  });

  it('onAttach captures the agent reference', () => {
    const ts = createToolStateToolSet();
    const detach = ts.onAttach?.({
      getTools: () => [],
      getRegisteredToolSets: () => [],
    } as AgentQueryFns);
    expect(detach).toBeUndefined();
  });

  // ── onFilterTools ──────────────────────────────────────────────────────────

  it('onFilterTools returns all tools when nothing is disabled and below threshold', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('t1'), makeTool('t2')];
    const filtered = ts.onFilterTools!(ctx, tools);
    expect(filtered).toHaveLength(2);
  });

  it('onFilterTools excludes disabled tools', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('t1'), makeTool('t2'), makeTool('t3')];
    ts.onFilterTools!(ctx, tools);
    ts.toggleTool(ctx, 't2');
    const filtered = ts.onFilterTools!(ctx, tools);
    expect(filtered.map((t: Tool) => t.name)).not.toContain('t2');
    expect(filtered.map((t: Tool) => t.name)).toContain('t1');
    expect(filtered.map((t: Tool) => t.name)).toContain('t3');
  });

  it('onFilterTools defers non-core tools when above threshold', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    // Attach agent with a ToolSet declaring core tools
    ts.onAttach?.({
      getTools: () => [],
      getRegisteredToolSets: () => [{ coreTools: ['core_a', 'core_b'] } as ToolSet],
    } as AgentQueryFns);

    const tools = Array.from({ length: TOOL_SEARCH_THRESHOLD + 5 }, (_, i) =>
      makeTool(i < 2 ? `core_${String.fromCharCode(97 + i)}` : `deferred_${i}`),
    );
    const filtered = ts.onFilterTools!(ctx, tools);
    // Only core tools + tool_search should remain
    expect(filtered.map((t: Tool) => t.name)).toContain('core_a');
    expect(filtered.map((t: Tool) => t.name)).toContain('core_b');
    expect(filtered.every((t: Tool) => !t.name.startsWith('deferred_'))).toBe(true);
  });

  // ── toggleTool ─────────────────────────────────────────────────────────────

  it('toggleTool disables an enabled tool', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.toggleTool(ctx, 'echo');
    ts.onFilterTools!(ctx, [makeTool('echo')]);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.toolStates[0].enabled).toBe(false);
  });

  it('toggleTool re-enables a disabled tool', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.toggleTool(ctx, 'echo');
    ts.toggleTool(ctx, 'echo');
    ts.onFilterTools!(ctx, [makeTool('echo')]);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.toolStates[0].enabled).toBe(true);
  });

  // ── onInit ──────────────────────────────────────────────────────────────────

  it('onInit restores disabled tools from entryData.toolStates', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx('s1');
    ts.onInit!(ctx, { id: 's1', title: 'T', toolStates: { echo: false, search: true } });
    ts.onFilterTools!(ctx, [makeTool('echo'), makeTool('search')]);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.toolStates.find((t) => t.name === 'echo')?.enabled).toBe(false);
    expect(state.toolStates.find((t) => t.name === 'search')?.enabled).toBe(true);
  });

  it('onInit ignores missing toolStates', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx('s1');
    expect(() => ts.onInit!(ctx, { id: 's1', title: 'T' })).not.toThrow();
    ts.onFilterTools!(ctx, [makeTool('echo')]);
    const state = ts.onGetSymbolState!(ctx);
    expect(state.toolStates[0].enabled).toBe(true);
  });

  // ── onRemove ────────────────────────────────────────────────────────────────

  it('onRemove clears disabled state for the session', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx('s1');
    const tools = [makeTool('echo')];
    ts.onFilterTools!(ctx, tools);
    ts.toggleTool(ctx, 'echo');
    ts.onRemove!(ctx);
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates[0].enabled).toBe(true);
  });

  it('onRemove does not affect other sessions', () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onFilterTools!(ctx1, [makeTool('echo')]);
    ts.toggleTool(ctx1, 'echo');
    ts.onFilterTools!(ctx2, [makeTool('search')]);
    ts.toggleTool(ctx2, 'search');
    ts.onRemove!(ctx1);
    const state2 = ts.onGetSymbolState!(ctx2);
    expect(state2.toolStates.find((t) => t.name === 'search')?.enabled).toBe(false);
  });

  // ── onGetSymbolState ───────────────────────────────────────────────────────

  it('onGetSymbolState returns toolStates with enabled=true for all tools', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('echo'), makeTool('search')];
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates.find((t) => t.name === 'echo')?.enabled).toBe(true);
    expect(state.toolStates.find((t) => t.name === 'search')?.enabled).toBe(true);
  });

  it('onGetSymbolState marks disabled tools with enabled=false', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('echo'), makeTool('search')];
    ts.onFilterTools!(ctx, tools);
    ts.toggleTool(ctx, 'echo');
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates.find((t) => t.name === 'echo')?.enabled).toBe(false);
    expect(state.toolStates.find((t) => t.name === 'search')?.enabled).toBe(true);
  });

  it('onGetSymbolState includes group in each entry', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('g1', undefined, 'Grp')];
    const state = ts.onGetSymbolState!(ctx, { tools });
    expect(state.toolStates[0].group).toBe('Grp');
  });

  // ── onSubscribe ────────────────────────────────────────────────────────────

  it('onSubscribe fires when a tool is toggled', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const fn = vi.fn();
    ts.onSubscribe!(ctx, fn);
    ts.toggleTool(ctx, 'echo');
    expect(fn).toHaveBeenCalled();
  });

  it('onSubscribe returns an unsubscribe function', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const fn = vi.fn();
    const unsub = ts.onSubscribe!(ctx, fn);
    unsub();
    ts.toggleTool(ctx, 'echo');
    expect(fn).not.toHaveBeenCalled();
  });

  // ── onBuildSnapshot ────────────────────────────────────────────────────────

  it('onBuildSnapshot returns empty object when no tools or state', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const snap = ts.onBuildSnapshot!(ctx);
    expect(snap).toEqual({});
  });

  it('onBuildSnapshot persists enabled/disabled states', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('echo'), makeTool('search')];
    ts.onFilterTools!(ctx, tools);
    ts.toggleTool(ctx, 'echo');
    const snap = ts.onBuildSnapshot!(ctx);
    expect(snap.toolStates?.['echo']).toBe(false);
    expect(snap.toolStates?.['search']).toBe(true);
  });

  // ── scope isolation ────────────────────────────────────────────────────────

  it('different sessions have independent disabled sets', () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onFilterTools!(ctx1, [makeTool('echo')]);
    ts.toggleTool(ctx1, 'echo');
    ts.onFilterTools!(ctx2, [makeTool('echo')]);
    const state2 = ts.onGetSymbolState!(ctx2);
    expect(state2.toolStates[0].enabled).toBe(true);
  });

  // ── onBeforeToolExecute ────────────────────────────────────────────────────

  it('onBeforeToolExecute blocks disabled tools with a failure result', async () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, [makeTool('echo')]);
    ts.toggleTool(ctx, 'echo');
    const tool = makeTool('echo');
    const execCtx = makeExecCtx();
    const intercept = await ts.onBeforeToolExecute!(ctx, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({
      allow: false,
      result: {
        toolCallId: 'call_00_test123',
        name: 'echo',
        result: { ok: false, error: 'Tool "echo" is currently disabled.' },
      },
    });
  });

  it('onBeforeToolExecute allows enabled tools through', async () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tool = makeTool('echo');
    const execCtx = makeExecCtx();
    const intercept = await ts.onBeforeToolExecute!(ctx, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({ allow: true });
  });

  it('onBeforeToolExecute is per-session isolated', async () => {
    const ts = createToolStateToolSet();
    const ctx1 = makeCtx('s1');
    const ctx2 = makeCtx('s2');
    ts.onFilterTools!(ctx1, [makeTool('echo')]);
    ts.toggleTool(ctx1, 'echo');
    const tool = makeTool('echo');
    const execCtx = makeExecCtx();
    const intercept = await ts.onBeforeToolExecute!(ctx2, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({ allow: true });
  });

  it('re-enabling a disabled tool allows it to execute again', async () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    ts.onFilterTools!(ctx, [makeTool('echo')]);
    ts.toggleTool(ctx, 'echo');
    ts.toggleTool(ctx, 'echo');
    const tool = makeTool('echo');
    const execCtx = makeExecCtx();
    const intercept = await ts.onBeforeToolExecute!(ctx, 'echo', tool, {}, execCtx);
    expect(intercept).toEqual({ allow: true });
  });

  // ── onGetSystemPrompt ──────────────────────────────────────────────────────

  it('onGetSystemPrompt returns guidance when deferred tools exist', () => {
    const ts = createToolStateToolSet();
    ts.onAttach?.({
      getTools: () => Array.from({ length: TOOL_SEARCH_THRESHOLD + 5 }, (_, i) => makeTool(`tool_${i}`)),
      getRegisteredToolSets: () => [],
    } as unknown as AgentQueryFns);

    const result = ts.onGetSystemPrompt?.(
      makeCtx(),
      { userMessage: undefined, baseSystemPrompt: undefined, currentSystemPromptParts: [], suppressToolSetPrompt: vi.fn() },
      [],
    );
    expect(result).toContain('Available Deferred Tools');
  });

  it('onGetSystemPrompt excludes disabled tools from deferred listing', () => {
    const ts = createToolStateToolSet();
    const ctx = makeCtx();
    const tools = [makeTool('core_tool'), makeTool('disabled_deferred'), makeTool('enabled_deferred')];
    ts.onAttach?.({
      getTools: () => tools,
      getRegisteredToolSets: () => [{ coreTools: ['core_tool'] } as ToolSet],
    } as unknown as AgentQueryFns);
    ts.onFilterTools!(ctx, tools);
    ts.toggleTool(ctx, 'disabled_deferred');

    const result = ts.onGetSystemPrompt?.(
      ctx,
      { userMessage: undefined, baseSystemPrompt: undefined, currentSystemPromptParts: [], suppressToolSetPrompt: vi.fn() },
      [],
    );
    expect(result).toContain('enabled_deferred');
    expect(result).not.toContain('disabled_deferred');
    expect(result).not.toContain('core_tool');
  });

  it('onGetSystemPrompt returns undefined when no deferred tools', () => {
    const ts = createToolStateToolSet();
    ts.onAttach?.({
      getTools: () => [makeTool('tool_search')],
      getRegisteredToolSets: () => [],
    } as unknown as AgentQueryFns);

    const result = ts.onGetSystemPrompt?.(
      makeCtx(),
      { userMessage: undefined, baseSystemPrompt: undefined, currentSystemPromptParts: [], suppressToolSetPrompt: vi.fn() },
      [],
    );
    expect(result).toBeUndefined();
  });
});

