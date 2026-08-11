/**
 * Tests for backend/lib/core-app-host.js
 */

import { describe, it, expect, vi } from 'vitest';

describe('createCoreAppHost', () => {
  async function getModule() {
    const mod = await import('../lib/core-app-host.js');
    return mod;
  }

  it('creates a host with defineApi and defineStream', async () => {
    const { createCoreAppHost } = await getModule();
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const host = createCoreAppHost('test-app', router);

    expect(host).toHaveProperty('defineApi');
    expect(host).toHaveProperty('defineStream');
    expect(typeof host.defineApi).toBe('function');
    expect(typeof host.defineStream).toBe('function');
  });

  it('defineApi delegates to router.registerApi with appId', async () => {
    const { createCoreAppHost } = await getModule();
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const host = createCoreAppHost('my-app', router);
    const handler = async () => 'ok';

    host.defineApi('doStuff', handler);

    expect(router.registerApi).toHaveBeenCalledWith('my-app', 'doStuff', handler);
  });

  it('defineStream delegates to router.registerStream with appId', async () => {
    const { createCoreAppHost } = await getModule();
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const host = createCoreAppHost('my-app', router);
    const handler = () => ({ subscribe: () => ({ unsubscribe: () => {} }) });

    host.defineStream('myStream', handler);

    expect(router.registerStream).toHaveBeenCalledWith('my-app', 'myStream', handler);
  });
});
