/**
 * Tests for agent-UI/plugin/core/system.ts, proxy.ts, models.ts,
 * sessions.ts, model-config.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mock for createPluginApiClient ─────────────────────────────────────

const mockCall = vi.hoisted(() => vi.fn());
const mockConnectStream = vi.hoisted(() => vi.fn());

vi.mock('../plugin/apiClient', () => ({
  createPluginApiClient: vi.fn(() => ({ call: mockCall, connectStream: mockConnectStream })),
}));

import { fetchPublicKey, checkHealth } from '../plugin/core/system';
import { getProxyConfig, updateProxyConfig, testProxyTarget } from '../plugin/core/proxy';
import { listModels } from '../plugin/core/models';
import { loadSessions, saveSessions } from '../plugin/core/sessions';
import {
  fetchMergedModelConfig, fetchBuiltInModelConfig, fetchCustomModelConfig,
  saveCustomModelConfig, addCustomModelProvider, removeCustomModelProvider,
  updateCustomModelProvider,
} from '../plugin/core/model-config';

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════════
// system
// ═══════════════════════════════════════════════════════════════════════════════

describe('core system plugin', () => {
  it('fetchPublicKey calls system.publicKey', async () => {
    mockCall.mockResolvedValue({ publicKey: 'pem-data' });
    const result = await fetchPublicKey();
    expect(result).toEqual({ publicKey: 'pem-data' });
    expect(mockCall).toHaveBeenCalledWith('publicKey');
  });

  it('checkHealth calls system.health', async () => {
    mockCall.mockResolvedValue({ status: 'ok' });
    const result = await checkHealth();
    expect(result).toEqual({ status: 'ok' });
    expect(mockCall).toHaveBeenCalledWith('health');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// proxy
// ═══════════════════════════════════════════════════════════════════════════════

describe('core proxy plugin', () => {
  it('getProxyConfig calls proxy.getConfig', async () => {
    mockCall.mockResolvedValue({ config: { host: 'localhost', port: 7890 } });
    const result = await getProxyConfig();
    expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
    expect(mockCall).toHaveBeenCalledWith('getConfig');
  });

  it('updateProxyConfig calls proxy.updateConfig', async () => {
    mockCall.mockResolvedValue(undefined);
    const cfg = { enabled: true, protocol: 'http' as const, host: 'localhost', port: 7890, username: '', password: '', noProxy: '', connectTimeout: 10000 };
    await updateProxyConfig(cfg);
    expect(mockCall).toHaveBeenCalledWith('updateConfig', cfg);
  });

  it('testProxyTarget calls proxy.test with target', async () => {
    mockCall.mockResolvedValue({ ok: true, ms: 100 });
    const result = await testProxyTarget('https://example.com');
    expect(result).toEqual({ ok: true, ms: 100 });
    expect(mockCall).toHaveBeenCalledWith('test', { target: 'https://example.com' });
  });

  it('testProxyTarget works with overrides', async () => {
    mockCall.mockResolvedValue({ ok: true, ms: 50 });
    const overrides = { host: 'override-host', port: 9999 };
    const result = await testProxyTarget(undefined, overrides);
    expect(result.ok).toBe(true);
    expect(mockCall).toHaveBeenCalledWith('test', { target: undefined, ...overrides });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// models
// ═══════════════════════════════════════════════════════════════════════════════

describe('core models plugin', () => {
  it('listModels calls models.list', async () => {
    mockCall.mockResolvedValue([{ id: 'm1', name: 'Model 1' }]);
    const result = await listModels('doubao');
    expect(result).toEqual([{ id: 'm1', name: 'Model 1' }]);
    expect(mockCall).toHaveBeenCalledWith('list', { provider: 'doubao' });
  });

  it('listModels works without provider', async () => {
    mockCall.mockResolvedValue([]);
    const result = await listModels();
    expect(result).toEqual([]);
    expect(mockCall).toHaveBeenCalledWith('list', { provider: undefined });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sessions
// ═══════════════════════════════════════════════════════════════════════════════

describe('core sessions plugin', () => {
  it('loadSessions calls sessions.load', async () => {
    const sessions = [{ id: 's1', title: 'S1' }];
    mockCall.mockResolvedValue({ sessions });
    const result = await loadSessions('agent-1');
    expect(result).toEqual(sessions);
    expect(mockCall).toHaveBeenCalledWith('load', { agentId: 'agent-1' });
  });

  it('loadSessions returns empty array on error', async () => {
    mockCall.mockRejectedValue(new Error('err'));
    const result = await loadSessions('agent-1');
    expect(result).toEqual([]);
  });

  it('loadSessions returns empty array for non-array sessions', async () => {
    mockCall.mockResolvedValue({ sessions: 'not-array' });
    const result = await loadSessions('agent-1');
    expect(result).toEqual([]);
  });

  it('saveSessions calls sessions.save', async () => {
    const sessions = [{ id: 's1', title: 'S1' }];
    mockCall.mockResolvedValue(undefined);
    await saveSessions('agent-1', sessions);
    expect(mockCall).toHaveBeenCalledWith('save', { agentId: 'agent-1', sessions });
  });

  it('saveSessions handles error silently', async () => {
    mockCall.mockRejectedValue(new Error('err'));
    await expect(saveSessions('agent-1', [])).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// model-config
// ═══════════════════════════════════════════════════════════════════════════════

describe('core model-config plugin', () => {
  it('fetchMergedModelConfig calls model-config.get', async () => {
    mockCall.mockResolvedValue([{ name: 'cfg' }]);
    const result = await fetchMergedModelConfig();
    expect(result).toEqual([{ name: 'cfg' }]);
    expect(mockCall).toHaveBeenCalledWith('get');
  });

  it('fetchMergedModelConfig returns [] for non-array', async () => {
    mockCall.mockResolvedValue({ not: 'array' });
    const result = await fetchMergedModelConfig();
    expect(result).toEqual([]);
  });

  it('fetchBuiltInModelConfig calls model-config.getBuiltIn', async () => {
    mockCall.mockResolvedValue([{ name: 'builtin' }]);
    const result = await fetchBuiltInModelConfig();
    expect(result).toEqual([{ name: 'builtin' }]);
    expect(mockCall).toHaveBeenCalledWith('getBuiltIn');
  });

  it('fetchCustomModelConfig calls model-config.getCustom', async () => {
    mockCall.mockResolvedValue([{ name: 'custom' }]);
    const result = await fetchCustomModelConfig();
    expect(result).toEqual([{ name: 'custom' }]);
    expect(mockCall).toHaveBeenCalledWith('getCustom');
  });

  it('saveCustomModelConfig calls model-config.saveCustom', async () => {
    mockCall.mockResolvedValue(undefined);
    const cfg = [{ name: 'cfg', vendor: 'v', apiKey: '', apiType: 'chat-completions', models: [] }];
    await saveCustomModelConfig(cfg);
    expect(mockCall).toHaveBeenCalledWith('saveCustom', { config: cfg });
  });

  it('addCustomModelProvider calls model-config.addCustom', async () => {
    mockCall.mockResolvedValue(undefined);
    const entry = { name: 'New', vendor: 'v', apiKey: '', apiType: 'chat-completions' as const, models: [] };
    await addCustomModelProvider(entry);
    expect(mockCall).toHaveBeenCalledWith('addCustom', { entry });
  });

  it('removeCustomModelProvider calls model-config.removeCustom', async () => {
    mockCall.mockResolvedValue(undefined);
    await removeCustomModelProvider('Old');
    expect(mockCall).toHaveBeenCalledWith('removeCustom', { name: 'Old' });
  });

  it('updateCustomModelProvider calls model-config.updateCustom', async () => {
    mockCall.mockResolvedValue(undefined);
    await updateCustomModelProvider('Old', { name: 'New', vendor: 'v', apiKey: '', apiType: 'chat-completions', models: [] });
    expect(mockCall).toHaveBeenCalledWith('updateCustom', { name: 'Old', entry: { name: 'New', vendor: 'v', apiKey: '', apiType: 'chat-completions', models: [] } });
  });
});
