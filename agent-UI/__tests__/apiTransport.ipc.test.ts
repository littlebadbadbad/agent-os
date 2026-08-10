/**
 * Tests for super built-in plugin API clients �� IPC (Electron) path
 *
 * The old apiTransport.ts has been replaced by PluginApiClient-based
 * core API wrappers (agent-UI/plugin/core/). These tests verify that
 * the core plugin API clients correctly route calls through the
 * dual-transport PluginApiClient mechanism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ���� Module-level mocks ����������������������������������������������������������������������������������������������������������������

vi.mock('../env', () => ({ IS_ELECTRON_IPC: true }));
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

import { createPluginApiClient } from '../plugin/apiClient';

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// PluginApiClient �� unified dual-transport client for core plugins
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T

describe('PluginApiClient (IPC mode) �� system plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin:system:publicKey for publicKey method', async () => {
    mockInvoke.mockResolvedValue({ publicKey: 'pem-data' });
    const client = createPluginApiClient('system');
    const result = await client.call('publicKey');
    expect(result).toEqual({ publicKey: 'pem-data' });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:system:publicKey', {});
  });
});

describe('PluginApiClient (IPC mode) �� proxy plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin:proxy:getConfig', async () => {
    mockInvoke.mockResolvedValue({ config: { host: 'localhost', port: 7890 } });
    const client = createPluginApiClient('proxy');
    const result = await client.call('getConfig');
    expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:proxy:getConfig', {});
  });

  it('calls plugin:proxy:updateConfig with body params', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const client = createPluginApiClient('proxy');
    await client.call('updateConfig', { host: 'localhost', port: 7890 });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:proxy:updateConfig', { host: 'localhost', port: 7890 });
  });
});

describe('PluginApiClient (IPC mode) �� models plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin:models:list with provider param', async () => {
    mockInvoke.mockResolvedValue([{ id: 'deepseek-v4', name: 'DeepSeek V4' }]);
    const client = createPluginApiClient('models');
    const result = await client.call('list', { provider: 'doubao' });
    expect(result).toEqual([{ id: 'deepseek-v4', name: 'DeepSeek V4' }]);
    expect(mockInvoke).toHaveBeenCalledWith('plugin:models:list', { provider: 'doubao' });
  });
});

describe('PluginApiClient (IPC mode) �� api-keys plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin:api-keys:list', async () => {
    mockInvoke.mockResolvedValue({ keys: { DeepSeek: '????abcd' } });
    const client = createPluginApiClient('api-keys');
    const result = await client.call('list');
    expect(result).toEqual({ keys: { DeepSeek: '????abcd' } });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:api-keys:list', {});
  });

  it('calls plugin:api-keys:save with providerId and encryptedKey', async () => {
    mockInvoke.mockResolvedValue({ masked: '????xyz' });
    const client = createPluginApiClient('api-keys');
    const result = await client.call('save', { providerId: 'DeepSeek', encryptedKey: 'encrypted-base64' });
    expect(result).toEqual({ masked: '????xyz' });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:api-keys:save', { providerId: 'DeepSeek', encryptedKey: 'encrypted-base64' });
  });

  it('calls plugin:api-keys:delete with providerId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const client = createPluginApiClient('api-keys');
    await client.call('delete', { providerId: 'DeepSeek' });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:api-keys:delete', { providerId: 'DeepSeek' });
  });
});

describe('PluginApiClient (IPC mode) �� sessions plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls plugin:sessions:load with agentId', async () => {
    const sessions = [{ id: 's1', title: 'Session 1' }];
    mockInvoke.mockResolvedValue({ sessions });
    const client = createPluginApiClient('sessions');
    const result = await client.call('load', { agentId: 'stream-agent' });
    expect(result).toEqual({ sessions });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:sessions:load', { agentId: 'stream-agent' });
  });

  it('calls plugin:sessions:save with agentId and sessions', async () => {
    const sessions = [{ id: 's1', title: 'Session 1' }];
    mockInvoke.mockResolvedValue(undefined);
    const client = createPluginApiClient('sessions');
    await client.call('save', { agentId: 'stream-agent', sessions });
    expect(mockInvoke).toHaveBeenCalledWith('plugin:sessions:save', { agentId: 'stream-agent', sessions });
  });
});
