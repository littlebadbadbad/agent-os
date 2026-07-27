/**
 * Tests for agent-UI/store/providerConfigStore.ts — Config-driven provider store
 *
 * Mocks the API layer. Tests all store operations: load, getProviders,
 * getProvider, getModels, getSelectedProvider, getSelectedModel,
 * getSelection, setSelection, saveProviders, subscribe, isLoaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the API module ───────────────────────────────────────────────────────

const mockFetchMergedModelConfig = vi.fn();
const mockFetchBuiltInModelConfig = vi.fn();
const mockFetchCustomModelConfig = vi.fn();
const mockSaveCustomModelConfig = vi.fn();
vi.mock('../api/providerConfigApi', () => ({
  fetchMergedModelConfig: (...a: unknown[]) => mockFetchMergedModelConfig(...a),
  fetchBuiltInModelConfig: (...a: unknown[]) => mockFetchBuiltInModelConfig(...a),
  fetchCustomModelConfig: (...a: unknown[]) => mockFetchCustomModelConfig(...a),
  saveCustomModelConfig: (...a: unknown[]) => mockSaveCustomModelConfig(...a),
}));

import { providerConfigStore } from '../store/providerConfigStore';

const SAMPLE_CONFIG = [
  {
    name: 'DeepSeek',
    apiKey: '${input:secret}',
    apiType: 'chat-completions' as const,
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', url: 'https://api.deepseek.com/v1', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', url: 'https://api.deepseek.com/v1', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 },
    ],
  },
  {
    name: 'GLM',
    apiKey: '${input:secret}',
    apiType: 'chat-completions' as const,
    models: [
      { id: 'glm-4.6v', name: 'glm-4.6v', url: 'https://open.bigmodel.cn/api/paas/v4', toolCalling: true, vision: true, maxInputTokens: 131072, maxOutputTokens: 8192 },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  providerConfigStore._reset();
});

describe('providerConfigStore', () => {
  // ── load ─────────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('loads providers from API and sets default selection', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);

      await providerConfigStore.load();

      expect(providerConfigStore.isLoaded()).toBe(true);
      expect(providerConfigStore.getProviders()).toEqual(SAMPLE_CONFIG);
      expect(providerConfigStore.getSelection()).toEqual({
        providerName: 'DeepSeek',
        modelId: 'deepseek-v4-flash',
      });
    });

    it('preserves existing selection when already set', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      providerConfigStore.setSelection({ providerName: 'GLM', modelId: 'glm-4.6v' });

      await providerConfigStore.load();

      expect(providerConfigStore.getSelection()).toEqual({
        providerName: 'GLM',
        modelId: 'glm-4.6v',
      });
    });

    it('handles API failure gracefully', async () => {
      mockFetchMergedModelConfig.mockRejectedValue(new Error('Network error'));

      await providerConfigStore.load();

      expect(providerConfigStore.isLoaded()).toBe(true);
      expect(providerConfigStore.getProviders()).toEqual([]);
    });
  });

  // ── getProviders / getProvider ──────────────────────────────────────────

  describe('getProviders / getProvider', () => {
    it('getProviders returns all providers', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      expect(providerConfigStore.getProviders()).toHaveLength(2);
    });

    it('getProvider finds by name', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      const p = providerConfigStore.getProvider('GLM');
      expect(p?.name).toBe('GLM');
    });

    it('getProvider returns undefined for unknown', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      expect(providerConfigStore.getProvider('Unknown')).toBeUndefined();
    });
  });

  // ── getModels ───────────────────────────────────────────────────────────

  describe('getModels', () => {
    it('returns models for existing provider', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      const models = providerConfigStore.getModels('DeepSeek');
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('deepseek-v4-flash');
    });

    it('returns empty array for unknown provider', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      expect(providerConfigStore.getModels('Unknown')).toEqual([]);
    });
  });

  // ── getSelectedProvider / getSelectedModel ─────────────────────────────

  describe('getSelectedProvider / getSelectedModel', () => {
    it('getSelectedProvider returns current provider', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      const p = providerConfigStore.getSelectedProvider();
      expect(p?.name).toBe('DeepSeek');
    });

    it('getSelectedModel returns the selected model config', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      const m = providerConfigStore.getSelectedModel();
      expect(m?.id).toBe('deepseek-v4-flash');
      expect(m?.maxInputTokens).toBe(1048576);
    });

    it('returns undefined when no selection matches', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      providerConfigStore.setSelection({ providerName: 'Unknown', modelId: 'x' });
      expect(providerConfigStore.getSelectedProvider()).toBeUndefined();
      expect(providerConfigStore.getSelectedModel()).toBeUndefined();
    });
  });

  // ── setSelection / getSelection / getProviderName ──────────────────────

  describe('selection operations', () => {
    it('setSelection updates selection', async () => {
      mockFetchMergedModelConfig.mockResolvedValue(SAMPLE_CONFIG);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      providerConfigStore.setSelection({ providerName: 'GLM', modelId: 'glm-4.6v' });
      expect(providerConfigStore.getSelection()).toEqual({ providerName: 'GLM', modelId: 'glm-4.6v' });
      expect(providerConfigStore.getProviderName()).toBe('GLM');
    });

    it('setSelection notifies subscribers', async () => {
      const fn = vi.fn();
      const unsub = providerConfigStore.subscribe(fn);
      providerConfigStore.setSelection({ providerName: 'GLM', modelId: 'glm-4.6v' });
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsubscribe stops notifications', async () => {
      const fn = vi.fn();
      const unsub = providerConfigStore.subscribe(fn);
      unsub();
      providerConfigStore.setSelection({ providerName: 'GLM', modelId: 'glm-4.6v' });
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // ── saveProviders ──────────────────────────────────────────────────────

  describe('saveProviders', () => {
    it('persists and updates local state', async () => {
      mockSaveCustomModelConfig.mockResolvedValue(undefined);
      // Set up required state for merge
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      mockFetchMergedModelConfig.mockResolvedValue([]);
      // Load first so builtInProviders is populated
      await providerConfigStore.load();
      await providerConfigStore.saveProviders(SAMPLE_CONFIG);
      expect(mockSaveCustomModelConfig).toHaveBeenCalledWith(SAMPLE_CONFIG);
      expect(providerConfigStore.getProviders()).toEqual(SAMPLE_CONFIG);
    });
  });

  // ── isLoaded ───────────────────────────────────────────────────────────

  describe('isLoaded', () => {
    it('returns false before load', () => {
      expect(providerConfigStore.isLoaded()).toBe(false);
    });

    it('returns true after load', async () => {
      mockFetchMergedModelConfig.mockResolvedValue([]);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      expect(providerConfigStore.isLoaded()).toBe(true);
    });
  });

  // ── getBuiltInProviders / getCustomProviders ────────────────────────────

  describe('getBuiltInProviders / getCustomProviders', () => {
    it('getBuiltInProviders returns built-in list', async () => {
      const builtIn = [{ name: 'BuiltIn', apiKey: '', apiType: 'chat-completions' as const, models: [] }];
      mockFetchMergedModelConfig.mockResolvedValue([]);
      mockFetchBuiltInModelConfig.mockResolvedValue(builtIn);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      expect(providerConfigStore.getBuiltInProviders()).toEqual(builtIn);
    });

    it('getCustomProviders returns custom list', async () => {
      const custom = [{ name: 'Custom', apiKey: 'key', apiType: 'chat-completions' as const, models: [] }];
      mockFetchMergedModelConfig.mockResolvedValue([]);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue(custom);
      await providerConfigStore.load();
      expect(providerConfigStore.getCustomProviders()).toEqual(custom);
    });

    it('returns empty array when no providers exist', () => {
      expect(providerConfigStore.getBuiltInProviders()).toEqual([]);
      expect(providerConfigStore.getCustomProviders()).toEqual([]);
    });
  });

  // ── reloadCustom ───────────────────────────────────────────────────────

  describe('reloadCustom', () => {
    it('re-fetches custom config and re-merges', async () => {
      const builtIn = [{ name: 'A', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions' as const, models: [{ id: 'm1', name: 'm1', url: '', toolCalling: false, vision: false, maxInputTokens: 4096, maxOutputTokens: 4096 }] }];
      const custom = [{ name: 'B', vendor: 'customendpoint', apiKey: 'k', apiType: 'chat-completions' as const, models: [{ id: 'm2', name: 'm2', url: '', toolCalling: false, vision: false, maxInputTokens: 4096, maxOutputTokens: 4096 }] }];
      mockFetchMergedModelConfig.mockResolvedValue([...builtIn, ...custom]);
      mockFetchBuiltInModelConfig.mockResolvedValue(builtIn);
      mockFetchCustomModelConfig.mockResolvedValue([]);
      await providerConfigStore.load();
      expect(providerConfigStore.getCustomProviders()).toEqual([]);

      mockFetchCustomModelConfig.mockResolvedValue(custom);
      await providerConfigStore.reloadCustom();
      expect(providerConfigStore.getCustomProviders()).toEqual(custom);
      // merged should include both
      expect(providerConfigStore.getProviders()).toHaveLength(2);
    });

    it('handles API failure gracefully (keeps previous state)', async () => {
      mockFetchCustomModelConfig.mockRejectedValue(new Error('fail'));
      await providerConfigStore.reloadCustom();
      // state should still be initial (empty)
      expect(providerConfigStore.getCustomProviders()).toEqual([]);
    });
  });

  // ── reloadBuiltIn ──────────────────────────────────────────────────────

  describe('reloadBuiltIn', () => {
    it('re-fetches built-in config and re-merges', async () => {
      const builtIn = [{ name: 'A', apiKey: '', apiType: 'chat-completions' as const, models: [{ id: 'm1', name: 'm1', url: '', toolCalling: false, vision: false, maxInputTokens: 4096, maxOutputTokens: 4096 }] }];
      const custom = [{ name: 'B', apiKey: 'k', apiType: 'chat-completions' as const, models: [{ id: 'm2', name: 'm2', url: '', toolCalling: false, vision: false, maxInputTokens: 4096, maxOutputTokens: 4096 }] }];
      mockFetchMergedModelConfig.mockResolvedValue(custom);
      mockFetchBuiltInModelConfig.mockResolvedValue([]);
      mockFetchCustomModelConfig.mockResolvedValue(custom);
      await providerConfigStore.load();
      expect(providerConfigStore.getBuiltInProviders()).toEqual([]);

      mockFetchBuiltInModelConfig.mockResolvedValue(builtIn);
      await providerConfigStore.reloadBuiltIn();
      expect(providerConfigStore.getBuiltInProviders()).toEqual(builtIn);
      expect(providerConfigStore.getProviders()).toHaveLength(2);
    });

    it('handles API failure gracefully', async () => {
      mockFetchBuiltInModelConfig.mockRejectedValue(new Error('fail'));
      await providerConfigStore.reloadBuiltIn();
      expect(providerConfigStore.getBuiltInProviders()).toEqual([]);
    });
  });
});
