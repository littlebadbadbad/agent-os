/**
 * Tests for backend/core/system.js — super built-in "system" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/system.js', () => ({
  getPublicKeyInfo: vi.fn(),
  checkHealth: vi.fn(),
}));

import * as systemService from '../services/system.js';

describe('core/system plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/system.js');
    register = mod.register;
  });

  it('registers system plugin with correct pluginId', () => {
    register(router);

    expect(router.registerApi).toHaveBeenCalledTimes(2);
    expect(router.registerApi).toHaveBeenCalledWith(
      'system', 'publicKey', expect.any(Function),
    );
    expect(router.registerApi).toHaveBeenCalledWith(
      'system', 'health', expect.any(Function),
    );
  });

  it('publicKey handler returns public key info', async () => {
    register(router);
    const [, , handler] = router.registerApi.mock.calls.find(
      ([, method]) => method === 'publicKey',
    );
    vi.mocked(systemService.getPublicKeyInfo).mockReturnValue({ publicKey: 'pem-data' });

    const result = await handler();

    expect(result).toEqual({ publicKey: 'pem-data' });
    expect(systemService.getPublicKeyInfo).toHaveBeenCalledOnce();
  });

  it('health handler returns health check result', async () => {
    register(router);
    const [, , handler] = router.registerApi.mock.calls.find(
      ([, method]) => method === 'health',
    );
    vi.mocked(systemService.checkHealth).mockReturnValue({ status: 'ok' });

    const result = await handler();

    expect(result).toEqual({ status: 'ok' });
    expect(systemService.checkHealth).toHaveBeenCalledOnce();
  });
});
