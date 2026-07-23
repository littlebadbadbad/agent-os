/**
 * Tests for backend/core/api-keys.js — super built-in "api-keys" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/api-keys.js', () => ({
  getKeyList: vi.fn(),
  saveKey: vi.fn(),
  removeKey: vi.fn(),
}));

import { getKeyList, saveKey, removeKey } from '../services/api-keys.js';

describe('core/api-keys plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/api-keys.js');
    register = mod.register;
  });

  it('registers list, save, delete', () => {
    register(router);
    expect(router.registerApi).toHaveBeenCalledWith('api-keys', 'list', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('api-keys', 'save', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('api-keys', 'delete', expect.any(Function));
  });

  it('list returns key list', async () => {
    register(router);
    const h = findHandler('list');
    vi.mocked(getKeyList).mockReturnValue({ keys: { dp: '••••abcd' } });

    const result = await h();

    expect(result).toEqual({ keys: { dp: '••••abcd' } });
  });

  it('save stores key and returns result', async () => {
    register(router);
    const h = findHandler('save');
    vi.mocked(saveKey).mockReturnValue({ masked: '••••xyz' });

    const result = await h({ providerId: 'dp', encryptedKey: 'enc' });

    expect(result).toEqual({ masked: '••••xyz' });
    expect(saveKey).toHaveBeenCalledWith('dp', 'enc');
  });

  it('save throws if providerId missing', async () => {
    register(router);
    const h = findHandler('save');
    await expect(h({ encryptedKey: 'enc' })).rejects.toThrow('providerId is required');
  });

  it('delete removes key', async () => {
    register(router);
    const h = findHandler('delete');
    vi.mocked(removeKey).mockReturnValue(undefined);

    const result = await h({ providerId: 'dp' });

    expect(removeKey).toHaveBeenCalledWith('dp');
  });

  it('delete throws if providerId missing', async () => {
    register(router);
    const h = findHandler('delete');
    await expect(h({})).rejects.toThrow('providerId is required');
  });

  function findHandler(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)[2];
  }
});
