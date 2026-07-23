/**
 * Tests for backend/core/proxy.js — super built-in "proxy" plugin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/proxy.js', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  testProxyTarget: vi.fn(),
}));

import * as proxyService from '../services/proxy.js';

describe('core/proxy plugin', () => {
  let router;
  let register;

  beforeEach(async () => {
    vi.clearAllMocks();
    router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const mod = await import('../core/proxy.js');
    register = mod.register;
  });

  it('registers all proxy methods', () => {
    register(router);

    expect(router.registerApi).toHaveBeenCalledTimes(3);
    expect(router.registerApi).toHaveBeenCalledWith('proxy', 'getConfig', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('proxy', 'updateConfig', expect.any(Function));
    expect(router.registerApi).toHaveBeenCalledWith('proxy', 'test', expect.any(Function));
  });

  it('getConfig returns proxy config', async () => {
    register(router);
    const handler = findHandler('getConfig');
    vi.mocked(proxyService.getConfig).mockReturnValue({ host: 'localhost', port: 7890 });

    const result = await handler();

    expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
  });

  it('updateConfig delegates to service', async () => {
    register(router);
    const handler = findHandler('updateConfig');
    const config = { host: 'new-host', port: 8080 };

    await handler(config);

    expect(proxyService.updateConfig).toHaveBeenCalledWith(config);
  });

  it('test proxies to service with defaults', async () => {
    register(router);
    const handler = findHandler('test');
    vi.mocked(proxyService.testProxyTarget).mockResolvedValue({ ok: true, ms: 100 });

    const result = await handler(undefined);

    expect(result).toEqual({ ok: true, ms: 100, error: undefined });
    expect(proxyService.testProxyTarget).toHaveBeenCalledWith('https://www.google.com', undefined);
  });

  it('test proxies to service with custom target', async () => {
    register(router);
    const handler = findHandler('test');
    vi.mocked(proxyService.testProxyTarget).mockResolvedValue({ ok: false, error: 'timeout' });

    const result = await handler({ target: 'https://example.com' });

    expect(result.ok).toBe(false);
    expect(proxyService.testProxyTarget).toHaveBeenCalledWith('https://example.com', undefined);
  });

  function findHandler(method) {
    return router.registerApi.mock.calls.find(([, m]) => m === method)[2];
  }
});
