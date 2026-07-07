import { describe, it, expect, vi } from 'vitest';
import { createModuleTools } from '../../tools/dynamicTool/moduleTools';
import type { DynamicToolAdapter } from '../../tools/dynamicTool/types';

function makeAdapter(overrides?: Partial<DynamicToolAdapter>): DynamicToolAdapter {
  return {
    createTool: vi.fn(),
    updateTool: vi.fn(),
    deleteTool: vi.fn(),
    listTools: vi.fn().mockResolvedValue([]),
    executeTool: vi.fn(),
    createModule: vi.fn(),
    updateModule: vi.fn(),
    deleteModule: vi.fn(),
    listModules: vi.fn().mockResolvedValue([]),
    getModule: vi.fn(),
    installDeps: vi.fn(),
    listDeps: vi.fn(),
    removeDep: vi.fn(),
    ...overrides,
  };
}

function getTool(adapter: DynamicToolAdapter, name: string) {
  return (createModuleTools(adapter) as unknown as any[]).find(t => t.name === name)!;
}

describe('createModuleTools', () => {
  it('exports all 5 module tools', () => {
    const tools = createModuleTools(makeAdapter());
    const names = (tools as unknown as any[]).map(t => t.name);
    expect(names).toContain('create_module');
    expect(names).toContain('list_modules');
    expect(names).toContain('get_module');
    expect(names).toContain('update_module');
    expect(names).toContain('delete_module');
  });

  describe('create_module', () => {
    it('calls adapter.createModule and returns success message', async () => {
      const adapter = makeAdapter({ createModule: vi.fn().mockResolvedValue(undefined) });
      const tool = getTool(adapter, 'create_module');
      const result = await tool.execute(
        { name: 'my-utils', description: 'Utility functions', content: 'export const x = 1;' },
        { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false, },
      );
      expect(adapter.createModule).toHaveBeenCalledWith({
        name: 'my-utils',
        description: 'Utility functions',
        content: 'export const x = 1;',
      });
      expect(result.created).toBe('my-utils');
      expect(result.message).toContain('my-utils');
    });
  });

  describe('list_modules', () => {
    it('returns message when no modules exist', async () => {
      const adapter = makeAdapter({ listModules: vi.fn().mockResolvedValue([]) });
      const tool = getTool(adapter, 'list_modules');
      const result = await tool.execute({}, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false, });
      expect(result.message).toContain('No shared modules');
      expect(result.modules).toEqual([]);
    });

    it('returns formatted module list with count', async () => {
      const modules = [
        { name: 'string-utils', description: 'String helpers', createdAt: '2024-01-01' },
        { name: 'http-client', description: 'HTTP client', createdAt: '2024-01-02' },
      ];
      const adapter = makeAdapter({ listModules: vi.fn().mockResolvedValue(modules) });
      const tool = getTool(adapter, 'list_modules');
      const result = await tool.execute({}, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false, });
      expect(result.count).toBe(2);
      expect(result.modules).toHaveLength(2);
    });
  });

  describe('get_module', () => {
    it('calls adapter.getModule with the name', async () => {
      const adapter = makeAdapter({ getModule: vi.fn().mockResolvedValue({ name: 'my-mod', description: 'test', content: 'export const a = 1;' }) });
      const tool = getTool(adapter, 'get_module');
      const result = await tool.execute(
        { name: 'my-mod' },
        { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false, },
      );
      expect(adapter.getModule).toHaveBeenCalledWith('my-mod');
      expect(result.content).toBe('export const a = 1;');
    });
  });

  describe('update_module', () => {
    it('calls adapter.updateModule with name and optional fields', async () => {
      const adapter = makeAdapter({ updateModule: vi.fn().mockResolvedValue(undefined) });
      const tool = getTool(adapter, 'update_module');
      const result = await tool.execute(
        { name: 'my-mod', description: 'Updated desc', content: 'export const b = 2;' },
        { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false, },
      );
      expect(adapter.updateModule).toHaveBeenCalledWith('my-mod', { description: 'Updated desc', content: 'export const b = 2;' });
      expect(result.updated).toBe('my-mod');
    });
  });

  describe('delete_module', () => {
    it('calls adapter.deleteModule with the name', async () => {
      const adapter = makeAdapter({ deleteModule: vi.fn().mockResolvedValue(undefined) });
      const tool = getTool(adapter, 'delete_module');
      const result = await tool.execute(
        { name: 'my-mod' },
        { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', sourceAgent: 'main', isSubAgent: false, },
      );
      expect(adapter.deleteModule).toHaveBeenCalledWith('my-mod');
      expect(result.deleted).toBe('my-mod');
    });
  });
});
