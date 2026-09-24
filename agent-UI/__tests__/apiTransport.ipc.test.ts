/**
 * Tests for super built-in app API clients �� IPC (Electron) path
 *
 * The old apiTransport.ts has been replaced by AppApiClient-based
 * core API wrappers (agent-UI/app/core/). These tests verify that
 * the core app API clients correctly route calls through the
 * dual-transport AppApiClient mechanism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ���� Module-level mocks ����������������������������������������������������������������������������������������������������������������

vi.mock('../env', () => ({ IS_ELECTRON_IPC: true, IS_DEBUG: false }));
vi.mock('../config', () => ({ BACKEND_URL: '' }));

const mockInvoke = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  (globalThis as any).window = {
    electronAPI: {
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };
});

import { createAppApiClient } from '../app/apiClient';

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// AppApiClient �� unified dual-transport client for core apps
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T

describe('AppApiClient (IPC mode) �� system app', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls app:system:publicKey for publicKey method', async () => {
    mockInvoke.mockResolvedValue({ publicKey: 'pem-data' });
    const client = createAppApiClient('system');
    const result = await client.call('publicKey');
    expect(result).toEqual({ publicKey: 'pem-data' });
    expect(mockInvoke).toHaveBeenCalledWith('app:system:publicKey', {});
  });
});

describe('AppApiClient (IPC mode) �� proxy app', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls app:proxy:getConfig', async () => {
    mockInvoke.mockResolvedValue({ config: { host: 'localhost', port: 7890 } });
    const client = createAppApiClient('proxy');
    const result = await client.call('getConfig');
    expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
    expect(mockInvoke).toHaveBeenCalledWith('app:proxy:getConfig', {});
  });

  it('calls app:proxy:updateConfig with body params', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const client = createAppApiClient('proxy');
    await client.call('updateConfig', { host: 'localhost', port: 7890 });
    expect(mockInvoke).toHaveBeenCalledWith('app:proxy:updateConfig', { host: 'localhost', port: 7890 });
  });
});

describe('AppApiClient (IPC mode) �� models app', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls app:models:list with provider param', async () => {
    mockInvoke.mockResolvedValue([{ id: 'deepseek-v4', name: 'DeepSeek V4' }]);
    const client = createAppApiClient('models');
    const result = await client.call('list', { provider: 'doubao' });
    expect(result).toEqual([{ id: 'deepseek-v4', name: 'DeepSeek V4' }]);
    expect(mockInvoke).toHaveBeenCalledWith('app:models:list', { provider: 'doubao' });
  });
});

describe('AppApiClient (IPC mode) �� api-keys app', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls app:api-keys:list', async () => {
    mockInvoke.mockResolvedValue({ keys: { DeepSeek: '????abcd' } });
    const client = createAppApiClient('api-keys');
    const result = await client.call('list');
    expect(result).toEqual({ keys: { DeepSeek: '????abcd' } });
    expect(mockInvoke).toHaveBeenCalledWith('app:api-keys:list', {});
  });

  it('calls app:api-keys:save with providerId and encryptedKey', async () => {
    mockInvoke.mockResolvedValue({ masked: '????xyz' });
    const client = createAppApiClient('api-keys');
    const result = await client.call('save', { providerId: 'DeepSeek', encryptedKey: 'encrypted-base64' });
    expect(result).toEqual({ masked: '????xyz' });
    expect(mockInvoke).toHaveBeenCalledWith('app:api-keys:save', { providerId: 'DeepSeek', encryptedKey: 'encrypted-base64' });
  });

  it('calls app:api-keys:delete with providerId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const client = createAppApiClient('api-keys');
    await client.call('delete', { providerId: 'DeepSeek' });
    expect(mockInvoke).toHaveBeenCalledWith('app:api-keys:delete', { providerId: 'DeepSeek' });
  });
});

describe('AppApiClient (IPC mode) �� sessions app', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls app:sessions:load with agentId', async () => {
    const sessions = [{ id: 's1', title: 'Session 1' }];
    mockInvoke.mockResolvedValue({ sessions });
    const client = createAppApiClient('sessions');
    const result = await client.call('load', { agentId: 'stream-agent' });
    expect(result).toEqual({ sessions });
    expect(mockInvoke).toHaveBeenCalledWith('app:sessions:load', { agentId: 'stream-agent' });
  });

  it('calls app:sessions:save with agentId and sessions', async () => {
    const sessions = [{ id: 's1', title: 'Session 1' }];
    mockInvoke.mockResolvedValue(undefined);
    const client = createAppApiClient('sessions');
    await client.call('save', { agentId: 'stream-agent', sessions });
    expect(mockInvoke).toHaveBeenCalledWith('app:sessions:save', { agentId: 'stream-agent', sessions });
  });
});
