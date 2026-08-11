/**
 * Tests for backend/core/app-manager.js — super built-in "app-manager" app
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScanner = {
  getActiveApps: vi.fn(),
  getAppManifest: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
};

const mockConfigStore = {
  load: vi.fn(),
  save: vi.fn(),
};

vi.mock('../lib/app-scanner.js', () => ({
  isBuiltInApp: vi.fn((id) => id === 'built-in-app'),
}));

vi.mock('../../built-in-apps.json', () => ({ default: { apps: ['built-in-app'] } }));

describe('core/app-manager app', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/app-manager.js');
    register = mod.register;
  });

  it('registers all management methods', () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });

    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'list', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'getConfig', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'saveConfig', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'enable', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'disable', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'installZip', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'installFolder', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('app-manager', 'uninstall', expect.any(Function));
  });

  it('list returns active apps', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });

    mockScanner.getActiveApps.mockReturnValue([
      { manifest: { id: 'p1', name: 'App 1', version: '1.0' }, state: 'active' },
      { manifest: { id: 'built-in-app', name: 'Built-in', version: '2.0' }, state: 'active' },
    ]);

    const h = findHandler('list');
    const result = await h();

    expect(result.apps).toHaveLength(2);
    expect(result.apps[0].id).toBe('p1');
    expect(result.apps[1].id).toBe('built-in-app');
    expect(result.apps[1].builtIn).toBe(true);
  });

  it('getConfig returns app config', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    mockScanner.getAppManifest.mockReturnValue({ id: 'p1', properties: {} });
    mockConfigStore.load.mockReturnValue({ key: 'val' });

    const h = findHandler('getConfig');
    const result = await h({ appId: 'p1' });

    expect(result).toEqual({ key: 'val' });
    expect(mockScanner.getAppManifest).toHaveBeenCalledWith('p1');
  });

  it('getConfig throws if appId missing', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    const h = findHandler('getConfig');
    await expect(h({})).rejects.toThrow('appId is required');
  });

  it('saveConfig saves and returns ok', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    const h = findHandler('saveConfig');

    const result = await h({ appId: 'p1', config: { key: 'val' } });

    expect(result).toEqual({ ok: true });
    expect(mockConfigStore.save).toHaveBeenCalledWith('p1', { key: 'val' });
  });

  it('saveConfig throws for non-object config', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    const h = findHandler('saveConfig');
    await expect(h({ appId: 'p1', config: 'string' })).rejects.toThrow('config must be a JSON object');
  });

  it('enable delegates to scanner', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    mockScanner.enable.mockResolvedValue({ ok: true });

    const h = findHandler('enable');
    const result = await h({ appId: 'p1' });

    expect(result).toEqual({ ok: true });
    expect(mockScanner.enable).toHaveBeenCalledWith('p1');
  });

  it('disable delegates to scanner', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    mockScanner.disable.mockResolvedValue({ ok: true });

    const h = findHandler('disable');
    const result = await h({ appId: 'p1' });

    expect(result).toEqual({ ok: true });
    expect(mockScanner.disable).toHaveBeenCalledWith('p1');
  });

  it('uninstall delegates to scanner', async () => {
    register(router, { appScanner: mockScanner, appConfigStore: mockConfigStore });
    mockScanner.uninstall.mockResolvedValue({ ok: true });

    const h = findHandler('uninstall');
    const result = await h({ appId: 'p1' });

    expect(result).toEqual({ ok: true });
    expect(mockScanner.uninstall).toHaveBeenCalledWith('p1');
  });


  function findHandler(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)?.[2];
  }
});
