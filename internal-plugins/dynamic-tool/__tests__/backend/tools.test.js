/**
 * Tests for extensions/dynamic-tool/backend/services/tools.js
 *
 * All store calls are mocked — no real SQLite / file I/O.
 *
 * Covers every service function:
 *   getToolsList, createTool, updateTool, deleteTool, runTool,
 *   getModulesList, getToolModule, createToolModule, updateToolModule, deleteToolModule,
 *   getDepsList, installToolDeps, removeToolDep
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock store factories ──────────────────────────────────────────────────────

const mockToolStore = vi.hoisted(() => ({
  listTools:    vi.fn(),
  getTool:      vi.fn(),
  upsertTool:   vi.fn(),
  removeTool:   vi.fn(),
  executeTool:  vi.fn(),
}));

const mockModuleStore = vi.hoisted(() => ({
  listModules:  vi.fn(),
  getModule:    vi.fn(),
  upsertModule: vi.fn(),
  removeModule: vi.fn(),
}));

const mockDepStore = vi.hoisted(() => ({
  listDeps:    vi.fn(),
  installDeps: vi.fn(),
  removeDep:   vi.fn(),
}));

// We test the service layer directly by creating it with mocked stores.
// This bypasses the host.defineApi() wrapper (which is a thin passthrough).
import { createToolServices } from '../../backend/services/tools.js';

function makeServices() {
  vi.clearAllMocks();
  return createToolServices({
    toolStore: mockToolStore,
    moduleStore: mockModuleStore,
    depStore: mockDepStore,
  });
}

// ── getToolsList ──────────────────────────────────────────────────────────────

describe('getToolsList', () => {
  it('returns tools list from store', () => {
    mockToolStore.listTools.mockReturnValue([
      { name: 'add', description: 'adds numbers', parameters: {}, implementation: 'secret', runtime: 'backend', createdAt: 't' },
    ]);
    const svc = makeServices();
    const result = svc.getToolsList();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('add');
  });

  it('excludes implementation for backend tools', () => {
    mockToolStore.listTools.mockReturnValue([
      { name: 'x', description: 'd', parameters: {}, implementation: 'secret', runtime: 'backend', createdAt: 't' },
    ]);
    const svc = makeServices();
    expect(svc.getToolsList().tools[0].implementation).toBeUndefined();
  });

  it('includes implementation for frontend tools', () => {
    mockToolStore.listTools.mockReturnValue([
      { name: 'fe', description: 'd', parameters: {}, implementation: 'return 1', runtime: 'frontend', createdAt: 't' },
    ]);
    const svc = makeServices();
    expect(svc.getToolsList().tools[0].implementation).toBe('return 1');
  });
});

// ── createTool ────────────────────────────────────────────────────────────────

describe('createTool', () => {
  const valid = { name: 'my_tool', description: 'does something', implementation: 'return 1;', runtime: 'backend' };

  it('persists a valid tool', () => {
    const svc = makeServices();
    const result = svc.createTool(valid);
    expect(result.created).toBe('my_tool');
    expect(mockToolStore.upsertTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'my_tool' }));
  });

  it('defaults runtime to backend', () => {
    const svc = makeServices();
    const { runtime: _, ...noRuntime } = valid;
    svc.createTool(noRuntime);
    expect(mockToolStore.upsertTool).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'backend' }));
  });

  it('defaults parameters to empty object schema', () => {
    const svc = makeServices();
    const { parameters: _, ...noParams } = valid;
    svc.createTool(noParams);
    expect(mockToolStore.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { type: 'object', properties: {} } }),
    );
  });

  it('throws when name is missing', () => {
    const svc = makeServices();
    const { name: _, ...rest } = valid;
    expect(() => svc.createTool(rest)).toThrow(/name/);
  });

  it('throws when name is not snake_case', () => {
    const svc = makeServices();
    expect(() => svc.createTool({ ...valid, name: 'My-Tool' })).toThrow(/name/);
  });

  it('throws when name starts with a digit', () => {
    const svc = makeServices();
    expect(() => svc.createTool({ ...valid, name: '1bad' })).toThrow(/name/);
  });

  it('throws when description is missing', () => {
    const svc = makeServices();
    const { description: _, ...rest } = valid;
    expect(() => svc.createTool(rest)).toThrow(/description/);
  });

  it('throws when implementation is missing', () => {
    const svc = makeServices();
    const { implementation: _, ...rest } = valid;
    expect(() => svc.createTool(rest)).toThrow(/implementation/);
  });
});

// ── updateTool ────────────────────────────────────────────────────────────────

describe('updateTool', () => {
  it('updates an existing tool with merge', () => {
    mockToolStore.getTool.mockReturnValue({ name: 'my_tool', description: 'old', parameters: {}, implementation: 'old', runtime: 'backend' });
    const svc = makeServices();
    const result = svc.updateTool({ name: 'my_tool', patch: { description: 'new' } });
    expect(result.updated).toBe('my_tool');
    expect(mockToolStore.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'new', implementation: 'old' }),
    );
  });

  it('throws when tool not found', () => {
    mockToolStore.getTool.mockReturnValue(undefined);
    const svc = makeServices();
    expect(() => svc.updateTool({ name: 'ghost', patch: { description: 'x' } })).toThrow(/not found/);
  });

  it('throws when patch is empty', () => {
    mockToolStore.getTool.mockReturnValue({ name: 'x', description: 'd', parameters: {}, implementation: 'i', runtime: 'backend' });
    const svc = makeServices();
    expect(() => svc.updateTool({ name: 'x', patch: {} })).toThrow(/required/);
  });
});

// ── deleteTool ────────────────────────────────────────────────────────────────

describe('deleteTool', () => {
  it('deletes an existing tool', () => {
    mockToolStore.removeTool.mockReturnValue(true);
    const svc = makeServices();
    const result = svc.deleteTool({ name: 'my_tool' });
    expect(result.deleted).toBe('my_tool');
    expect(mockToolStore.removeTool).toHaveBeenCalledWith('my_tool');
  });

  it('throws when tool does not exist', () => {
    mockToolStore.removeTool.mockReturnValue(false);
    const svc = makeServices();
    expect(() => svc.deleteTool({ name: 'ghost' })).toThrow(/not found/);
  });
});

// ── runTool ───────────────────────────────────────────────────────────────────

describe('runTool', () => {
  it('executes a backend tool', async () => {
    mockToolStore.getTool.mockReturnValue({ name: 'add', runtime: 'backend' });
    mockToolStore.executeTool.mockResolvedValue(42);
    const svc = makeServices();
    const result = await svc.runTool({ name: 'add', args: { x: 1 }, ctx: {} });
    expect(result.result).toBe(42);
  });

  it('throws when tool not found', async () => {
    mockToolStore.getTool.mockReturnValue(undefined);
    const svc = makeServices();
    await expect(svc.runTool({ name: 'unknown' })).rejects.toThrow(/not found/);
  });

  it('throws when tool is frontend type', async () => {
    mockToolStore.getTool.mockReturnValue({ name: 'fe', runtime: 'frontend' });
    const svc = makeServices();
    await expect(svc.runTool({ name: 'fe' })).rejects.toThrow(/frontend/);
  });

  it('throws when name is missing', async () => {
    const svc = makeServices();
    await expect(svc.runTool({})).rejects.toThrow(/name/);
  });
});

// ── Module services ───────────────────────────────────────────────────────────

describe('module services', () => {
  it('getModulesList returns modules from store', () => {
    mockModuleStore.listModules.mockReturnValue([{ name: 'm', description: 'd' }]);
    const svc = makeServices();
    expect(svc.getModulesList().modules).toHaveLength(1);
  });

  it('getToolModule returns a module by name', () => {
    mockModuleStore.getModule.mockReturnValue({ name: 'm', description: 'd', content: 'export const x = 1;' });
    const svc = makeServices();
    expect(svc.getToolModule({ name: 'm' }).content).toBe('export const x = 1;');
  });

  it('getToolModule throws when not found', () => {
    mockModuleStore.getModule.mockReturnValue(undefined);
    const svc = makeServices();
    expect(() => svc.getToolModule({ name: 'ghost' })).toThrow(/not found/);
  });

  it('createToolModule persists a valid module', () => {
    const svc = makeServices();
    const result = svc.createToolModule({ name: 'my-utils', description: 'Utils', content: 'export const x = 1;' });
    expect(result.created).toBe('my-utils');
    expect(mockModuleStore.upsertModule).toHaveBeenCalled();
  });

  it('createToolModule throws when content has no export', () => {
    const svc = makeServices();
    expect(() => svc.createToolModule({ name: 'm', description: 'd', content: 'const x = 1;' })).toThrow(/export/);
  });

  it('updateToolModule updates existing module', () => {
    mockModuleStore.getModule.mockReturnValue({ name: 'm', description: 'old', content: 'e' });
    const svc = makeServices();
    const result = svc.updateToolModule({ name: 'm', patch: { description: 'new' } });
    expect(result.updated).toBe('m');
  });

  it('deleteToolModule deletes a module', () => {
    mockModuleStore.getModule.mockReturnValue({ name: 'm', description: 'd' });
    const svc = makeServices();
    expect(svc.deleteToolModule({ name: 'm' }).deleted).toBe('m');
  });
});

// ── Dep services ──────────────────────────────────────────────────────────────

describe('dep services', () => {
  it('getDepsList returns deps from store', () => {
    mockDepStore.listDeps.mockReturnValue({ dependencies: { axios: '1.0.0' }, devDependencies: {} });
    const svc = makeServices();
    expect(svc.getDepsList().dependencies.axios).toBe('1.0.0');
  });

  it('installToolDeps calls depStore.installDeps', async () => {
    mockDepStore.installDeps.mockResolvedValue({ success: true, packages: ['axios'], output: 'ok' });
    const svc = makeServices();
    const result = await svc.installToolDeps({ packages: ['axios'] });
    expect(result.success).toBe(true);
  });

  it('removeToolDep calls depStore.removeDep', async () => {
    mockDepStore.removeDep.mockResolvedValue({ success: true, output: 'ok' });
    const svc = makeServices();
    const result = await svc.removeToolDep({ pkg: 'axios' });
    expect(result.success).toBe(true);
  });
});
