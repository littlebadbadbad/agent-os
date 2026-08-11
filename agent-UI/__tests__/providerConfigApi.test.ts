/**
 * Tests for agent-UI/api/ — API adapter functions
 *
 * Tests both providerConfigApi.ts and backend.ts.
 * All API calls now go through AppApiClient (dual HTTP/IPC transport).
 * Mock createAppApiClient to intercept all core app calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock AppApiClient ──────────────────────────────────────────────────────

const mockCall = vi.hoisted(() => vi.fn());

vi.mock('../app/apiClient', () => ({
  createAppApiClient: () => ({ call: mockCall, connectStream: vi.fn() }),
}));

import { fetchMergedModelConfig, fetchBuiltInModelConfig, fetchCustomModelConfig, saveCustomModelConfig, addCustomModelProvider, removeCustomModelProvider, updateCustomModelProvider } from '../api/providerConfigApi';
import { fetchPublicKey, fetchApiKeys, saveApiKey, deleteApiKey, getProxyConfig, updateProxyConfig, loadSessions, saveSessions } from '../api/backend';
import type { ProviderEntry } from '../store/providerConfigStore';

const SAMPLE_CONFIG: ProviderEntry[] = [
  {
    name: 'DeepSeek',
    apiKey: '${input:secret}',
    apiType: 'chat-completions',
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', url: 'https://api.deepseek.com/v1', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// providerConfigApi.ts
// ═════════════════════════════════════════════════════════════════════════════

describe('providerConfigApi', () => {
  describe('fetchMergedModelConfig', () => {
    it('calls model-config.get and returns config array', async () => {
      mockCall.mockResolvedValue(SAMPLE_CONFIG);
      const result = await fetchMergedModelConfig();
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(mockCall).toHaveBeenCalledWith('get');
    });

    it('returns empty array when response is not an array', async () => {
      mockCall.mockResolvedValue({ not: 'array' });
      const result = await fetchMergedModelConfig();
      expect(result).toEqual([]);
    });
  });

  describe('fetchBuiltInModelConfig', () => {
    it('calls model-config.getBuiltIn', async () => {
      mockCall.mockResolvedValue(SAMPLE_CONFIG);
      const result = await fetchBuiltInModelConfig();
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(mockCall).toHaveBeenCalledWith('getBuiltIn');
    });
  });

  describe('fetchCustomModelConfig', () => {
    it('calls model-config.getCustom', async () => {
      mockCall.mockResolvedValue(SAMPLE_CONFIG);
      const result = await fetchCustomModelConfig();
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(mockCall).toHaveBeenCalledWith('getCustom');
    });
  });

  describe('saveCustomModelConfig', () => {
    it('calls model-config.saveCustom with config', async () => {
      mockCall.mockResolvedValue(undefined);
      await saveCustomModelConfig(SAMPLE_CONFIG);
      expect(mockCall).toHaveBeenCalledWith('saveCustom', { config: SAMPLE_CONFIG });
    });
  });

  describe('addCustomModelProvider', () => {
    it('calls model-config.addCustom with entry', async () => {
      const entry = SAMPLE_CONFIG[0];
      mockCall.mockResolvedValue(undefined);
      await addCustomModelProvider(entry);
      expect(mockCall).toHaveBeenCalledWith('addCustom', { entry });
    });
  });

  describe('removeCustomModelProvider', () => {
    it('calls model-config.removeCustom with name', async () => {
      mockCall.mockResolvedValue(undefined);
      await removeCustomModelProvider('DeepSeek');
      expect(mockCall).toHaveBeenCalledWith('removeCustom', { name: 'DeepSeek' });
    });
  });

  describe('updateCustomModelProvider', () => {
    it('calls model-config.updateCustom with name and entry', async () => {
      mockCall.mockResolvedValue(undefined);
      await updateCustomModelProvider('DeepSeek', SAMPLE_CONFIG[0]);
      expect(mockCall).toHaveBeenCalledWith('updateCustom', { name: 'DeepSeek', entry: SAMPLE_CONFIG[0] });
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// backend.ts
// ═════════════════════════════════════════════════════════════════════════════

describe('backend', () => {
  describe('fetchPublicKey', () => {
    it('calls system.publicKey', async () => {
      mockCall.mockResolvedValue({ publicKey: 'pem-data' });
      const result = await fetchPublicKey();
      expect(result).toEqual({ publicKey: 'pem-data' });
      expect(mockCall).toHaveBeenCalledWith('publicKey');
    });
  });

  describe('fetchApiKeys', () => {
    it('calls api-keys.list', async () => {
      mockCall.mockResolvedValue({ keys: { DeepSeek: '••••abcd' } });
      const result = await fetchApiKeys();
      expect(result).toEqual({ keys: { DeepSeek: '••••abcd' } });
      expect(mockCall).toHaveBeenCalledWith('list');
    });
  });

  describe('saveApiKey', () => {
    it('calls api-keys.save with providerId and encryptedKey', async () => {
      mockCall.mockResolvedValue({ masked: '••••xyz' });
      const result = await saveApiKey('DeepSeek', 'encrypted-base64');
      expect(result).toEqual({ masked: '••••xyz' });
      expect(mockCall).toHaveBeenCalledWith('save', { providerId: 'DeepSeek', encryptedKey: 'encrypted-base64' });
    });
  });

  describe('deleteApiKey', () => {
    it('calls api-keys.delete with providerId', async () => {
      mockCall.mockResolvedValue(undefined);
      await deleteApiKey('DeepSeek');
      expect(mockCall).toHaveBeenCalledWith('delete', { providerId: 'DeepSeek' });
    });
  });

  describe('getProxyConfig', () => {
    it('calls proxy.getConfig', async () => {
      mockCall.mockResolvedValue({ config: { host: 'localhost', port: 7890 } });
      const result = await getProxyConfig();
      expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
      expect(mockCall).toHaveBeenCalledWith('getConfig');
    });
  });

  describe('updateProxyConfig', () => {
    it('calls proxy.updateConfig with config', async () => {
      mockCall.mockResolvedValue(undefined);
      await updateProxyConfig({ enabled: true, protocol: 'http', host: 'localhost', port: 7890, username: '', password: '', noProxy: '', connectTimeout: 10000 });
      expect(mockCall).toHaveBeenCalledWith('updateConfig', { enabled: true, protocol: 'http', host: 'localhost', port: 7890, username: '', password: '', noProxy: '', connectTimeout: 10000 });
    });
  });

  describe('loadSessions', () => {
    it('calls sessions.load with agentId', async () => {
      const sessions = [{ id: 's1', title: 'Session 1', subtitle: '', messages: [], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }];
      mockCall.mockResolvedValue({ sessions });
      const result = await loadSessions('stream-agent');
      expect(result).toEqual(sessions);
      expect(mockCall).toHaveBeenCalledWith('load', { agentId: 'stream-agent' });
    });

    it('returns empty array on API error', async () => {
      mockCall.mockRejectedValue(new Error('Network error'));
      const result = await loadSessions('stream-agent');
      expect(result).toEqual([]);
    });

    it('returns empty array when sessions field is not an array', async () => {
      mockCall.mockResolvedValue({ sessions: 'not-array' });
      const result = await loadSessions('stream-agent');
      expect(result).toEqual([]);
    });
  });

  describe('saveSessions', () => {
    it('calls sessions.save with agentId and sessions', async () => {
      const sessions = [{ id: 's1', title: 'Session 1', subtitle: '', messages: [], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }];
      mockCall.mockResolvedValue(undefined);
      await saveSessions('stream-agent', sessions);
      expect(mockCall).toHaveBeenCalledWith('save', { agentId: 'stream-agent', sessions });
    });

    it('handles API error silently', async () => {
      mockCall.mockRejectedValue(new Error('Network error'));
      await saveSessions('stream-agent', []);
      // Should not throw
    });
  });
});
