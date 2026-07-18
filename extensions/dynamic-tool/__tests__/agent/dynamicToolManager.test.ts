/**
 * Tests for extensions/dynamic-tool/agent/toolSet.ts (createDynamicToolset)
 *
 * All adapters are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDynamicToolset } from '../../agent/toolSet';
import type { DynamicToolAdapter, DynamicToolEntry } from '../../agent/types';
import type { AgentClientLike } from '@agent-type';
import type { Tool } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(overrides: Partial<DynamicToolAdapter> = {}): DynamicToolAdapter {
  return {
    listTools: vi.fn(async () => []),
    createTool: vi.fn(async (entry) => ({
      ...entry,
      createdAt: new Date().toISOString(),
    })),
    updateTool: vi.fn(async (name, patch) => ({
      name,
      description: patch.description ?? 'desc',
      parameters: patch.parameters ?? {},
      implementation: patch.implementation ?? 'return {};',
      runtime: patch.runtime ?? 'backend',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    deleteTool: vi.fn(async () => undefined),
    executeTool: vi.fn(async () => ({ output: 'executed' })),
    listModules: vi.fn(async () => []),
    getModule: vi.fn(async (name) => ({ name, description: 'desc', content: 'export const x = 1;' })),
    createModule: vi.fn(async (entry) => ({ name: entry.name, description: entry.description })),
    updateModule: vi.fn(async () => undefined),
    deleteModule: vi.fn(async () => undefined),
    listDeps: vi.fn(async () => ({ dependencies: {}, devDependencies: {} })),
    installDeps: vi.fn(async (pkgs) => ({ success: true, packages: pkgs, output: 'ok' })),
    removeDep: vi.fn(async () => ({ success: true, output: 'ok' })),
    ...overrides,
  };
}

function makeAgent() {
  const registered: Tool[] = [];
  return {
    registerTool: vi.fn((t: Tool) => {
      registered.push(t);
      return () => {
        const idx = registered.indexOf(t);
        if (idx !== -1) registered.splice(idx, 1);
      };
    }),
    registerToolSet: vi.fn(() => () => {}),
    getTools: () => [...registered],
    getFilteredTools: () => [...registered],
    getHandler: vi.fn(),
    getRegisteredToolSets: () => [] as any[],
    getRegistered: () => registered,
  };
}

function makeEntry(name: string, runtime: 'backend' | 'frontend' = 'backend'): DynamicToolEntry {
  return {
    name,
    description: `Description for ${name}`,
    parameters: { type: 'object', properties: {} },
    implementation: runtime === 'frontend'
      ? 'return { result: args.value };'
      : 'export async function run(args) { return { result: args.value }; }',
    runtime,
    createdAt: new Date().toISOString(),
  };
}

/** Resolve tools from a ToolSet — handles both array and factory forms. */
function resolveTools(ts: any): readonly Tool[] {
  return typeof ts.tools === 'function' ? ts.tools() : ts.tools;
}

// ── createDynamicToolset ──────────────────────────────────────────────────────────

describe('createDynamicToolset', () => {
  let agent: ReturnType<typeof makeAgent>;
  let adapter: DynamicToolAdapter;
  let manager: ReturnType<typeof createDynamicToolset>;
  let tools: readonly Tool[];

  beforeEach(async () => {
    agent = makeAgent();
    adapter = makeAdapter();
    manager = createDynamicToolset(adapter);
    tools = resolveTools(manager);
    manager.onAttach?.(agent as unknown as AgentClientLike);
    await Promise.resolve();
  });

  // ── exports ───────────────────────────────────────────────────────────────

  it('exports tools array with 12 meta-tools', () => {
    expect(tools).toHaveLength(12);
    const names = tools.map((t) => t.name);
    expect(names).toContain('create_tool');
    expect(names).toContain('list_dynamic_tools');
    expect(names).toContain('update_tool');
    expect(names).toContain('delete_tool');
    expect(names).toContain('create_module');
    expect(names).toContain('list_modules');
    expect(names).toContain('get_module');
    expect(names).toContain('update_module');
    expect(names).toContain('delete_module');
    expect(names).toContain('list_tool_deps');
    expect(names).toContain('install_tool_deps');
    expect(names).toContain('remove_tool_dep');
  });

  // ── startup re-hydration ──────────────────────────────────────────────────

  it('registers pre-existing tools from adapter.listTools() on startup', async () => {
    const existingEntry = makeEntry('preexisting_tool');
    const hydrationAdapter = makeAdapter({
      listTools: vi.fn(async () => [existingEntry]),
    });
    const hydrationAgent = makeAgent();
    const ts = createDynamicToolset(hydrationAdapter);
    ts.onAttach?.(hydrationAgent as unknown as AgentClientLike);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hydrationAgent.registerTool).toHaveBeenCalled();
    const registered = hydrationAgent.getRegistered();
    expect(registered.some((t) => t.name === 'preexisting_tool')).toBe(true);
  });

  it('silently ignores adapter.listTools() errors on startup', async () => {
    const failAdapter = makeAdapter({
      listTools: vi.fn(async () => { throw new Error('backend offline'); }),
    });
    expect(() => {
      const ts = createDynamicToolset(failAdapter);
      ts.onAttach?.(agent as unknown as AgentClientLike);
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // ── list_dynamic_tools ────────────────────────────────────────────────────

  it('list_dynamic_tools returns empty list initially', async () => {
    const result = await tools[1].execute({}, {} as any) as any;
    expect(result.message).toContain('No custom tools');
    expect(result.tools).toEqual([]);
  });

  it('list_dynamic_tools delegates to adapter.listTools', async () => {
    const listTool = tools.find((t) => t.name === 'list_dynamic_tools')!;
    await listTool.execute({}, {} as any);
    expect(adapter.listTools).toHaveBeenCalled();
  });

  it('list_dynamic_tools returns tools when adapter has entries', async () => {
    vi.mocked(adapter.listTools).mockResolvedValueOnce([makeEntry('existing_tool')]);
    const listTool = tools.find((t) => t.name === 'list_dynamic_tools')!;
    const result = await listTool.execute({}, {} as any) as any;
    expect(result.count).toBe(1);
    expect(result.tools[0].name).toBe('existing_tool');
  });

  // ── create_tool ───────────────────────────────────────────────────────────

  it('create_tool calls adapter.createTool with the correct parameters', async () => {
    const createTool = tools.find((t) => t.name === 'create_tool')!;
    await createTool.execute({
      name: 'my_tool',
      description: 'A useful tool for testing purposes.',
      parameters_schema: { type: 'object', properties: { value: { type: 'string' } } },
      implementation: 'export async function run(args) { return args; }',
      runtime: 'backend',
    }, {} as any);

    expect(adapter.createTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my_tool',
      description: 'A useful tool for testing purposes.',
      runtime: 'backend',
    }));
  });

  it('create_tool registers a proxy tool on all parent agents', async () => {
    const createTool = tools.find((t) => t.name === 'create_tool')!;
    await createTool.execute({
      name: 'proxy_tool',
      description: 'Tool to test proxy registration.',
      parameters_schema: { type: 'object' },
      implementation: 'export async function run(args) { return {}; }',
      runtime: 'backend',
    }, {} as any);

    const registered = agent.getRegistered();
    expect(registered.some((t) => t.name === 'proxy_tool')).toBe(true);
  });

  it('create_tool returns a success message', async () => {
    const createTool = tools.find((t) => t.name === 'create_tool')!;
    const result = await createTool.execute({
      name: 'success_tool',
      description: 'A tool that should return a success message.',
      parameters_schema: { type: 'object' },
      implementation: 'export async function run(args) { return {}; }',
      runtime: 'backend',
    }, {} as any) as any;

    expect(result.created).toBe('success_tool');
    expect(result.message).toContain('success_tool');
  });

  // ── update_tool ───────────────────────────────────────────────────────────

  it('update_tool calls adapter.updateTool', async () => {
    const updateTool = tools.find((t) => t.name === 'update_tool')!;
    await updateTool.execute({
      name: 'existing_tool',
      description: 'Updated description of the existing tool.',
    }, {} as any);

    expect(adapter.updateTool).toHaveBeenCalledWith('existing_tool', expect.objectContaining({
      description: 'Updated description of the existing tool.',
    }));
  });

  it('update_tool re-registers the proxy tool', async () => {
    const updateTool = tools.find((t) => t.name === 'update_tool')!;
    const callsBefore = agent.registerTool.mock.calls.length;
    await updateTool.execute({
      name: 'updated_proxy',
      description: 'Re-registered after this update call.',
    }, {} as any);
    expect(agent.registerTool.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('update_tool returns success message', async () => {
    const updateTool = tools.find((t) => t.name === 'update_tool')!;
    const result = await updateTool.execute({ name: 'some_tool' }, {} as any) as any;
    expect(result.updated).toBe('some_tool');
    expect(result.message).toContain('some_tool');
  });

  it('update_tool only passes defined fields to adapter', async () => {
    const updateTool = tools.find((t) => t.name === 'update_tool')!;
    await updateTool.execute({ name: 'partial_tool' }, {} as any);
    const patchArg = vi.mocked(adapter.updateTool).mock.calls[0][1];
    expect(Object.keys(patchArg)).toHaveLength(0);
  });

  // ── delete_tool ───────────────────────────────────────────────────────────

  it('delete_tool calls adapter.deleteTool', async () => {
    const deleteTool = tools.find((t) => t.name === 'delete_tool')!;
    await deleteTool.execute({ name: 'to_delete' }, {} as any);
    expect(adapter.deleteTool).toHaveBeenCalledWith('to_delete');
  });

  it('delete_tool unregisters the proxy from parent agents', async () => {
    const createTool = tools.find((t) => t.name === 'create_tool')!;
    await createTool.execute({
      name: 'doomed_tool',
      description: 'This tool is about to be deleted from all agents.',
      parameters_schema: { type: 'object' },
      implementation: 'export async function run(args) { return {}; }',
      runtime: 'backend',
    }, {} as any);

    expect(agent.getRegistered().some((t) => t.name === 'doomed_tool')).toBe(true);

    const deleteTool = tools.find((t) => t.name === 'delete_tool')!;
    await deleteTool.execute({ name: 'doomed_tool' }, {} as any);

    expect(agent.getRegistered().some((t) => t.name === 'doomed_tool')).toBe(false);
  });

  it('delete_tool returns success message', async () => {
    const deleteTool = tools.find((t) => t.name === 'delete_tool')!;
    const result = await deleteTool.execute({ name: 'dead_tool' }, {} as any) as any;
    expect(result.deleted).toBe('dead_tool');
    expect(result.message).toContain('dead_tool');
  });

  // ── proxy tool execution ──────────────────────────────────────────────────

  it('backend proxy routes execution through adapter.executeTool', async () => {
    const createTool = tools.find((t) => t.name === 'create_tool')!;
    await createTool.execute({
      name: 'backend_exec',
      description: 'Backend tool routed through the adapter executor.',
      parameters_schema: { type: 'object' },
      implementation: 'export async function run(args) { return args; }',
      runtime: 'backend',
    }, {} as any);

    const proxy = agent.getRegistered().find((t) => t.name === 'backend_exec')!;
    await proxy.execute({ value: 'test' }, { sessionId: 'session-1' } as any);
    expect(adapter.executeTool).toHaveBeenCalledWith(
      'backend_exec',
      { value: 'test' },
      expect.objectContaining({ sessionId: 'session-1' }),
    );
  });

  it('frontend proxy evaluates implementation directly', async () => {
    const createTool = tools.find((t) => t.name === 'create_tool')!;
    await createTool.execute({
      name: 'frontend_tool',
      description: 'Frontend tool',
      parameters_schema: { type: 'object', properties: { value: { type: 'number' } } },
      implementation: 'return { result: args.value * 2 };',
      runtime: 'frontend',
    }, {} as any);

    const proxy = agent.getRegistered().find((t) => t.name === 'frontend_tool')!;
    const result = await proxy.execute({ value: 21 }, { sessionId: '' } as any);
    expect(result).toEqual({ result: 42 });
  });
});
