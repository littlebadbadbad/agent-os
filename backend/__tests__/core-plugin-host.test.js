/**
 * Tests for backend/lib/core-plugin-host.js
 */

import { describe, it, expect, vi } from 'vitest';

describe('createCorePluginHost', () => {
  async function getModule() {
    const mod = await import('../lib/core-plugin-host.js');
    return mod;
  }

  it('creates a host with defineApi and defineStream', async () => {
    const { createCorePluginHost } = await getModule();
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const host = createCorePluginHost('test-plugin', router);

    expect(host).toHaveProperty('defineApi');
    expect(host).toHaveProperty('defineStream');
    expect(typeof host.defineApi).toBe('function');
    expect(typeof host.defineStream).toBe('function');
  });

  it('defineApi delegates to router.registerApi with pluginId', async () => {
    const { createCorePluginHost } = await getModule();
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const host = createCorePluginHost('my-plugin', router);
    const handler = async () => 'ok';

    host.defineApi('doStuff', handler);

    expect(router.registerApi).toHaveBeenCalledWith('my-plugin', 'doStuff', handler);
  });

  it('defineStream delegates to router.registerStream with pluginId', async () => {
    const { createCorePluginHost } = await getModule();
    const router = { registerApi: vi.fn(), registerStream: vi.fn() };
    const host = createCorePluginHost('my-plugin', router);
    const handler = () => ({ subscribe: () => ({ unsubscribe: () => {} }) });

    host.defineStream('myStream', handler);

    expect(router.registerStream).toHaveBeenCalledWith('my-plugin', 'myStream', handler);
  });
});
