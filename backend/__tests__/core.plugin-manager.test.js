/**
 * Tests for backend/core/plugin-manager.js — super built-in "plugin-manager" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScanner = {
  getActivePlugins: vi.fn(),
  getPluginManifest: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
};

const mockConfigStore = {
  load: vi.fn(),
  save: vi.fn(),
};

vi.mock('../lib/plugin-scanner.js', () => ({
  isBuiltInPlugin: vi.fn((id) => id === 'built-in-plugin'),
}));

vi.mock('../../built-in-plugins.json', () => ({ default: { plugins: ['built-in-plugin'] } }));

describe('core/plugin-manager plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/plugin-manager.js');
    register = mod.register;
  });

  it('registers all management methods', () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });

    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'list', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'getConfig', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'saveConfig', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'enable', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'disable', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'installZip', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'installFolder', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('plugin-manager', 'uninstall', expect.any(Function));
  });

  it('list returns active plugins', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });

    mockScanner.getActivePlugins.mockReturnValue([
      { manifest: { id: 'p1', name: 'Plugin 1', version: '1.0' }, state: 'active' },
      { manifest: { id: 'built-in-plugin', name: 'Built-in', version: '2.0' }, state: 'active' },
    ]);

    const h = findHandler('list');
    const result = await h();

    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0].id).toBe('p1');
    expect(result.plugins[1].id).toBe('built-in-plugin');
    expect(result.plugins[1].builtIn).toBe(true);
  });

  it('getConfig returns plugin config', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    mockScanner.getPluginManifest.mockReturnValue({ id: 'p1', properties: {} });
    mockConfigStore.load.mockReturnValue({ key: 'val' });

    const h = findHandler('getConfig');
    const result = await h({ pluginId: 'p1' });

    expect(result).toEqual({ key: 'val' });
    expect(mockScanner.getPluginManifest).toHaveBeenCalledWith('p1');
  });

  it('getConfig throws if pluginId missing', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    const h = findHandler('getConfig');
    await expect(h({})).rejects.toThrow('pluginId is required');
  });

  it('saveConfig saves and returns ok', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    const h = findHandler('saveConfig');

    const result = await h({ pluginId: 'p1', config: { key: 'val' } });

    expect(result).toEqual({ ok: true });
    expect(mockConfigStore.save).toHaveBeenCalledWith('p1', { key: 'val' });
  });

  it('saveConfig throws for non-object config', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    const h = findHandler('saveConfig');
    await expect(h({ pluginId: 'p1', config: 'string' })).rejects.toThrow('config must be a JSON object');
  });

  it('enable delegates to scanner', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    mockScanner.enable.mockResolvedValue({ ok: true });

    const h = findHandler('enable');
    const result = await h({ pluginId: 'p1' });

    expect(result).toEqual({ ok: true });
    expect(mockScanner.enable).toHaveBeenCalledWith('p1');
  });

  it('disable delegates to scanner', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    mockScanner.disable.mockResolvedValue({ ok: true });

    const h = findHandler('disable');
    const result = await h({ pluginId: 'p1' });

    expect(result).toEqual({ ok: true });
    expect(mockScanner.disable).toHaveBeenCalledWith('p1');
  });

  it('uninstall delegates to scanner', async () => {
    register(router, { pluginScanner: mockScanner, pluginConfigStore: mockConfigStore });
    mockScanner.uninstall.mockResolvedValue({ ok: true });

    const h = findHandler('uninstall');
    const result = await h({ pluginId: 'p1' });

    expect(result).toEqual({ ok: true });
    expect(mockScanner.uninstall).toHaveBeenCalledWith('p1');
  });


  function findHandler(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)?.[2];
  }
});
