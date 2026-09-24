/**
 * Tests for agent-UI/app/apiClient.ts — IPC mode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env to be Electron IPC at top level (hoisted by vitest)
vi.mock('../env', () => ({ IS_ELECTRON_IPC: true, IS_DEBUG: false }));

describe('AppApiClient — IPC mode', () => {
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
    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('system');

    mockInvoke.mockResolvedValue({ publicKey: 'pem' });
    const result = await client.call('publicKey');

    expect(result).toEqual({ publicKey: 'pem' });
    expect(mockInvoke).toHaveBeenCalledWith('app:system:publicKey', {});
  });

  it('uses custom invoke when provided via options', async () => {
    const customInvoke = vi.fn().mockResolvedValue('custom');
    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', { invoke: customInvoke });

    const result = await client.call('ping');

    expect(result).toBe('custom');
    expect(customInvoke).toHaveBeenCalledWith('app:test:ping', {});
  });

  it('wraps "No handler registered" errors as not-found', async () => {
    mockInvoke.mockRejectedValue(new Error('No handler registered for app:test:fail'));
    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test');

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
    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test');

    try {
      await client.call('fail');
      expect.unreachable();
    } catch (err: any) {
      expect(err.status).toBe('ipc');
      expect(err.message).toContain('IPC connection lost');
    }
  });
});
