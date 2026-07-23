/**
 * Tests for agent-UI/plugin/apiClient.ts — IPC mode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env to be Electron IPC at top level (hoisted by vitest)
vi.mock('../env', () => ({ IS_ELECTRON_IPC: true }));

describe('PluginApiClient — IPC mode', () => {
  const mockInvoke = vi.fn();
  const mockOn = vi.fn().mockReturnValue(vi.fn());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      electronAPI: { invoke: mockInvoke, on: mockOn, off: vi.fn(), removeAllListeners: vi.fn() },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates IPC client when IS_ELECTRON_IPC is true', async () => {
    const { createPluginApiClient } = await import('../plugin/apiClient');
    const client = createPluginApiClient('system');

    mockInvoke.mockResolvedValue({ publicKey: 'pem' });
    const result = await client.call('publicKey');

    expect(result).toEqual({ publicKey: 'pem' });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:system:publicKey', {});
  });

  it('uses custom invoke when provided via options', async () => {
    const customInvoke = vi.fn().mockResolvedValue('custom');
    const { createPluginApiClient } = await import('../plugin/apiClient');
    const client = createPluginApiClient('test', { invoke: customInvoke });

    const result = await client.call('ping');

    expect(result).toBe('custom');
    expect(customInvoke).toHaveBeenCalledWith('plugin:test:ping', {});
  });

  it('wraps "No handler registered" errors as not-found', async () => {
    mockInvoke.mockRejectedValue(new Error('No handler registered for plugin:test:fail'));
    const { createPluginApiClient } = await import('../plugin/apiClient');
    const client = createPluginApiClient('test');

    try {
      await client.call('fail');
      expect.unreachable();
    } catch (err: any) {
      expect(err.status).toBe('not-found');
      expect(err.message).toContain('test');
    }
  });

  it('wraps generic IPC errors', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC connection lost'));
    const { createPluginApiClient } = await import('../plugin/apiClient');
    const client = createPluginApiClient('test');

    try {
      await client.call('fail');
      expect.unreachable();
    } catch (err: any) {
      expect(err.status).toBe('ipc');
      expect(err.message).toContain('IPC connection lost');
    }
  });
});
