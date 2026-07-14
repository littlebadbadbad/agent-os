/**
 * Tests for agent-UI/api/ — API adapter functions
 *
 * Tests both providerConfigApi.ts and backend.ts.
 * Mocks apiTransport for all tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock apiTransport ─────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
const mockDel = vi.fn();

vi.mock('../transport/apiTransport', () => ({
  apiTransport: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
    post: (...a: unknown[]) => mockPost(...a),
    del: (...a: unknown[]) => mockDel(...a),
  },
}));

import { fetchMergedModelConfig, fetchBuiltInModelConfig, fetchCustomModelConfig, saveCustomModelConfig, addCustomModelProvider, removeCustomModelProvider, updateCustomModelProvider } from '../api/providerConfigApi';
import { fetchPublicKey, fetchApiKeys, saveApiKey, deleteApiKey, getProxyConfig, updateProxyConfig, loadSessions, saveSessions } from '../api/backend';
import type { ProviderEntry } from '../store/providerConfigStore';

const SAMPLE_CONFIG: ProviderEntry[] = [
  {
    name: 'DeepSeek',
    vendor: 'customendpoint',
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
    it('GETs merged config from /api/model-config', async () => {
      mockGet.mockResolvedValue(SAMPLE_CONFIG);
      const result = await fetchMergedModelConfig();
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(mockGet).toHaveBeenCalledWith('/api/model-config');
    });

    it('returns empty array when response is not an array', async () => {
      mockGet.mockResolvedValue({ not: 'array' });
      const result = await fetchMergedModelConfig();
      expect(result).toEqual([]);
    });
  });

  describe('fetchBuiltInModelConfig', () => {
    it('GETs built-in config from /api/model-config/built-in', async () => {
      mockGet.mockResolvedValue(SAMPLE_CONFIG);
      const result = await fetchBuiltInModelConfig();
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(mockGet).toHaveBeenCalledWith('/api/model-config/built-in');
    });
  });

  describe('fetchCustomModelConfig', () => {
    it('GETs custom config from /api/model-config/custom', async () => {
      mockGet.mockResolvedValue(SAMPLE_CONFIG);
      const result = await fetchCustomModelConfig();
      expect(result).toEqual(SAMPLE_CONFIG);
      expect(mockGet).toHaveBeenCalledWith('/api/model-config/custom');
    });
  });

  describe('saveCustomModelConfig', () => {
    it('PUTs the config to /api/model-config/custom', async () => {
      mockPut.mockResolvedValue(undefined);
      await saveCustomModelConfig(SAMPLE_CONFIG);
      expect(mockPut).toHaveBeenCalledWith('/api/model-config/custom', SAMPLE_CONFIG);
    });
  });

  describe('addCustomModelProvider', () => {
    it('POSTs a new provider entry', async () => {
      const entry = SAMPLE_CONFIG[0];
      mockPost.mockResolvedValue(undefined);
      await addCustomModelProvider(entry);
      expect(mockPost).toHaveBeenCalledWith('/api/model-config/custom/add', entry);
    });
  });

  describe('removeCustomModelProvider', () => {
    it('POSTs to remove a provider by name', async () => {
      mockPost.mockResolvedValue(undefined);
      await removeCustomModelProvider('DeepSeek');
      expect(mockPost).toHaveBeenCalledWith('/api/model-config/custom/remove', { name: 'DeepSeek' });
    });
  });

  describe('updateCustomModelProvider', () => {
    it('POSTs to update a provider', async () => {
      mockPost.mockResolvedValue(undefined);
      await updateCustomModelProvider('DeepSeek', SAMPLE_CONFIG[0]);
      expect(mockPost).toHaveBeenCalledWith('/api/model-config/custom/update', { name: 'DeepSeek', entry: SAMPLE_CONFIG[0] });
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// backend.ts
// ═════════════════════════════════════════════════════════════════════════════

describe('backend', () => {
  describe('fetchPublicKey', () => {
    it('GETs the public key endpoint', async () => {
      mockGet.mockResolvedValue({ publicKey: 'pem-data' });
      const result = await fetchPublicKey();
      expect(result).toEqual({ publicKey: 'pem-data' });
      expect(mockGet).toHaveBeenCalledWith('/api/public-key');
    });
  });

  describe('fetchApiKeys', () => {
    it('GETs the API keys endpoint', async () => {
      mockGet.mockResolvedValue({ keys: { DeepSeek: '••••abcd' } });
      const result = await fetchApiKeys();
      expect(result).toEqual({ keys: { DeepSeek: '••••abcd' } });
      expect(mockGet).toHaveBeenCalledWith('/api/api-keys');
    });
  });

  describe('saveApiKey', () => {
    it('POSTs an encrypted key', async () => {
      mockPost.mockResolvedValue({ masked: '••••xyz' });
      const result = await saveApiKey('DeepSeek', 'encrypted-base64');
      expect(result).toEqual({ masked: '••••xyz' });
      expect(mockPost).toHaveBeenCalledWith('/api/api-keys', { providerId: 'DeepSeek', encryptedKey: 'encrypted-base64' });
    });
  });

  describe('deleteApiKey', () => {
    it('DELETEs the provider key', async () => {
      mockDel.mockResolvedValue(undefined);
      await deleteApiKey('DeepSeek');
      expect(mockDel).toHaveBeenCalledWith('/api/api-keys/DeepSeek');
    });
  });

  describe('getProxyConfig', () => {
    it('GETs proxy config', async () => {
      mockGet.mockResolvedValue({ config: { host: 'localhost', port: 7890 } });
      const result = await getProxyConfig();
      expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
      expect(mockGet).toHaveBeenCalledWith('/api/proxy');
    });
  });

  describe('updateProxyConfig', () => {
    it('PUTs proxy config', async () => {
      mockPut.mockResolvedValue(undefined);
      await updateProxyConfig({ host: 'localhost', port: 7890 });
      expect(mockPut).toHaveBeenCalledWith('/api/proxy', { host: 'localhost', port: 7890 });
    });
  });

  describe('loadSessions', () => {
    it('GETs sessions for an agent', async () => {
      const sessions = [{ id: 's1', title: 'Session 1', messages: [], createdAt: 1000, updatedAt: 1000 }];
      mockGet.mockResolvedValue({ sessions });
      const result = await loadSessions('async-agent');
      expect(result).toEqual(sessions);
      expect(mockGet).toHaveBeenCalledWith('/api/agent-sessions/async-agent');
    });

    it('returns empty array on API error', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const result = await loadSessions('async-agent');
      expect(result).toEqual([]);
    });

    it('returns empty array when sessions field is not an array', async () => {
      mockGet.mockResolvedValue({ sessions: 'not-array' });
      const result = await loadSessions('async-agent');
      expect(result).toEqual([]);
    });
  });

  describe('saveSessions', () => {
    it('PUTs sessions for an agent', async () => {
      const sessions = [{ id: 's1', title: 'Session 1', messages: [], createdAt: 1000, updatedAt: 1000 }];
      mockPut.mockResolvedValue(undefined);
      await saveSessions('async-agent', sessions);
      expect(mockPut).toHaveBeenCalledWith('/api/agent-sessions/async-agent', { sessions });
    });

    it('handles API error silently', async () => {
      mockPut.mockRejectedValue(new Error('Network error'));
      await saveSessions('async-agent', []);
      // Should not throw
    });
  });
});
