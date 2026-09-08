/**
 * Tests for backend/core/model-config.js — super built-in "model-config" app
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/model-config.js', () => ({
  getMergedConfig: vi.fn(),
  getBuiltInConfig: vi.fn(),
  getCustomConfig: vi.fn(),
  saveCustomConfig: vi.fn(),
  addCustomProvider: vi.fn(),
  removeCustomProvider: vi.fn(),
  updateCustomProvider: vi.fn(),
}));

import * as mcs from '../services/model-config.js';

describe('core/model-config app', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/model-config.js');
    register = mod.register;
  });

  it('registers all 7 methods', () => {
    register(router);
    expect(router.registerApi).toHaveBeenCalledTimes(7);
    const methods = router.registerApi.mock.calls.map(([, m]) => m);
    expect(methods).toContain('get');
    expect(methods).toContain('getBuiltIn');
    expect(methods).toContain('getCustom');
    expect(methods).toContain('saveCustom');
    expect(methods).toContain('addCustom');
    expect(methods).toContain('removeCustom');
    expect(methods).toContain('updateCustom');
  });

  it('get returns merged config', async () => {
    register(router);
    const h = findHandler('get');
    vi.mocked(mcs.getMergedConfig).mockReturnValue([{ name: 'cfg' }]);
    expect(await h()).toEqual([{ name: 'cfg' }]);
  });

  it('getBuiltIn returns built-in config', async () => {
    register(router);
    const h = findHandler('getBuiltIn');
    vi.mocked(mcs.getBuiltInConfig).mockReturnValue([{ name: 'builtin' }]);
    expect(await h()).toEqual([{ name: 'builtin' }]);
  });

  it('getCustom returns custom config', async () => {
    register(router);
    const h = findHandler('getCustom');
    vi.mocked(mcs.getCustomConfig).mockReturnValue([{ name: 'custom' }]);
    expect(await h()).toEqual([{ name: 'custom' }]);
  });

  it('saveCustom stores config and returns ok', async () => {
    register(router);
    const h = findHandler('saveCustom');
    const cfg = [{ name: 'new' }];
    const result = await h({ config: cfg });
    expect(result).toEqual({ ok: true });
    expect(mcs.saveCustomConfig).toHaveBeenCalledWith(cfg);
  });

  it('addCustom adds provider and returns ok', async () => {
    register(router);
    const h = findHandler('addCustom');
    const entry = { name: 'NewProvider', models: [{ id: 'm', url: 'https://x/v1' }] };
    const result = await h({ entry });
    expect(result).toEqual({ ok: true });
    expect(mcs.addCustomProvider).toHaveBeenCalledWith(entry);
  });

  it('removeCustom removes provider by name', async () => {
    register(router);
    const h = findHandler('removeCustom');
    const result = await h({ name: 'OldProvider' });
    expect(result).toEqual({ ok: true });
    expect(mcs.removeCustomProvider).toHaveBeenCalledWith('OldProvider');
  });

  it('updateCustom throws if name missing', async () => {
    register(router);
    const h = findHandler('updateCustom');
    await expect(h({ entry: {} })).rejects.toThrow('name is required');
  });

  it('updateCustom updates provider', async () => {
    register(router);
    const h = findHandler('updateCustom');
    const result = await h({ name: 'P', entry: { models: [] } });
    expect(result).toEqual({ ok: true });
    expect(mcs.updateCustomProvider).toHaveBeenCalledWith('P', { models: [] });
  });

  function findHandler(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)[2];
  }
});
