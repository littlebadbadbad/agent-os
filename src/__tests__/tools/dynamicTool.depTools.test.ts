import { describe, it, expect, vi } from 'vitest';
import { createDepTools } from '../../tools/dynamicTool/depTools';
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
    installDeps: vi.fn().mockResolvedValue({ success: true, packages: [], output: '' }),
    listDeps: vi.fn().mockResolvedValue([]),
    removeDep: vi.fn().mockResolvedValue({ success: true, output: '' }),
    ...overrides,
  };
}

function getTool(name: string) {
  return (createDepTools(makeAdapter()) as unknown as any[]).find(t => t.name === name)!;
}

describe('createDepTools', () => {
  it('exports list_tool_deps, install_tool_deps, remove_tool_dep tools', () => {
    const tools = createDepTools(makeAdapter());
    const names = (tools as unknown as any[]).map(t => t.name);
    expect(names).toContain('list_tool_deps');
    expect(names).toContain('install_tool_deps');
    expect(names).toContain('remove_tool_dep');
  });

  describe('list_tool_deps', () => {
    it('delegates to adapter.listDeps()', async () => {
      const adapter = makeAdapter({
        listDeps: vi.fn().mockResolvedValue(['lodash', 'axios']),
      });
      const tools = createDepTools(adapter);
      const tool = (tools as unknown as any[]).find(t => t.name === 'list_tool_deps')!;
      const result = await tool.execute({}, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', });
      expect(adapter.listDeps).toHaveBeenCalled();
      expect(result).toEqual(['lodash', 'axios']);
    });
  });

  describe('install_tool_deps', () => {
    it('delegates to adapter.installDeps with packages', async () => {
      const adapter = makeAdapter({
        installDeps: vi.fn().mockResolvedValue({ success: true, packages: ['axios@1', 'lodash'], output: 'installed' }),
      });
      const tool = (createDepTools(adapter) as unknown as any[]).find(t => t.name === 'install_tool_deps')!;
      const result = await tool.execute({ packages: ['axios@1', 'lodash'] }, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', });
      expect(adapter.installDeps).toHaveBeenCalledWith(['axios@1', 'lodash']);
      expect(result.installed).toEqual(['axios@1', 'lodash']);
      expect(result.message).toContain('Installed');
    });

    it('throws when installation fails', async () => {
      const adapter = makeAdapter({
        installDeps: vi.fn().mockResolvedValue({ success: false, packages: [], output: 'error details' }),
      });
      const tool = (createDepTools(adapter) as unknown as any[]).find(t => t.name === 'install_tool_deps')!;
      await expect(tool.execute({ packages: ['bad-pkg'] }, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', })).rejects.toThrow('Package installation failed');
    });
  });

  describe('remove_tool_dep', () => {
    it('delegates to adapter.removeDep with package name', async () => {
      const adapter = makeAdapter({
        removeDep: vi.fn().mockResolvedValue({ success: true, output: 'removed' }),
      });
      const tool = (createDepTools(adapter) as unknown as any[]).find(t => t.name === 'remove_tool_dep')!;
      const result = await tool.execute({ package: 'axios' }, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', });
      expect(adapter.removeDep).toHaveBeenCalledWith('axios');
      expect(result.removed).toBe('axios');
    });

    it('throws when removal fails', async () => {
      const adapter = makeAdapter({
        removeDep: vi.fn().mockResolvedValue({ success: false, output: 'not found' }),
      });
      const tool = (createDepTools(adapter) as unknown as any[]).find(t => t.name === 'remove_tool_dep')!;
      await expect(tool.execute({ package: 'missing' }, { signal: new AbortController().signal, sessionId: '', agentName: 'main', conversationId: '', })).rejects.toThrow('Package removal failed');
    });
  });
});
