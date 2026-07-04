/**
 * Tests for agent-UI/store/providerStore.ts — Thin facade over providerConfigStore
 *
 * Mocks providerConfigStore. Tests: get, getSelection, setSelection,
 * getSelectedModel, subscribe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock providerConfigStore ──────────────────────────────────────────────────

const configStoreCallback = vi.hoisted(() => ({ current: null as (() => void) | null }));

const mockConfigStore = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getProvider: vi.fn(),
  getSelection: vi.fn(),
  setSelection: vi.fn(),
  subscribe: vi.fn((fn: () => void) => {
    configStoreCallback.current = fn;
    return vi.fn();
  }),
  isLoaded: vi.fn(),
  getModels: vi.fn(),
  getSelectedProvider: vi.fn(),
  getSelectedModel: vi.fn(),
  getProviderName: vi.fn(),
  saveProviders: vi.fn(),
  load: vi.fn(),
}));

vi.mock('../store/providerConfigStore', () => ({
  providerConfigStore: mockConfigStore,
}));

// Import after mocks — module evaluates the top-level subscribe call
import { providerStore } from '../store/providerStore';

const SAMPLE_PROVIDERS = [
  {
    name: 'DeepSeek',
    vendor: 'customendpoint',
    apiKey: '',
    apiType: 'chat-completions',
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', url: 'https://api.deepseek.com/v1', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 },
    ],
  },
  {
    name: 'GLM',
    vendor: 'customendpoint',
    apiKey: '',
    apiType: 'chat-completions',
    models: [
      { id: 'glm-4.6v', name: 'glm-4.6v', url: 'https://open.bigmodel.cn/api/paas/v4', toolCalling: true, vision: true, maxInputTokens: 131072, maxOutputTokens: 8192 },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('providerStore', () => {
  describe('get / getSelection', () => {
    it('syncs from config store via subscribe', () => {
      mockConfigStore.getSelection.mockReturnValue({ providerName: 'GLM', modelId: 'glm-4.6v' });
      // Trigger the subscribe callback that providerStore registered
      configStoreCallback.current?.();

      expect(providerStore.get()).toBe('GLM');
      expect(providerStore.getSelection()).toEqual({ providerId: 'GLM', modelId: 'glm-4.6v' });
    });
  });

  describe('setSelection', () => {
    it('delegates to config store and notifies own subscribers', () => {
      const fn = vi.fn();
      const unsub = providerStore.subscribe(fn);

      providerStore.setSelection({ providerId: 'GLM', modelId: 'glm-4.6v' });

      expect(mockConfigStore.setSelection).toHaveBeenCalledWith({
        providerName: 'GLM',
        modelId: 'glm-4.6v',
      });
      expect(fn).toHaveBeenCalled();
      unsub();
    });
  });

  describe('getSelectedModel', () => {
    it('returns ModelMeta with contextWindow', () => {
      // First sync from config
      mockConfigStore.getSelection.mockReturnValue({ providerName: 'DeepSeek', modelId: 'deepseek-v4-flash' });
      configStoreCallback.current?.();

      // Set up the provider lookup
      mockConfigStore.getProvider.mockReturnValue(SAMPLE_PROVIDERS[0]);

      const meta = providerStore.getSelectedModel();
      expect(meta.id).toBe('deepseek-v4-flash');
      expect(meta.contextWindow).toBe(1048576);
      expect(meta.description).toBe('');
    });

    it('returns 0 contextWindow when no matching model', () => {
      mockConfigStore.getSelection.mockReturnValue({ providerName: 'Unknown', modelId: 'x' });
      configStoreCallback.current?.();

      mockConfigStore.getProvider.mockReturnValue(undefined);

      const meta = providerStore.getSelectedModel();
      expect(meta.contextWindow).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('calls subscriber on config store change trigger', () => {
      const fn = vi.fn();
      const unsub = providerStore.subscribe(fn);

      // Simulate the config store's subscribe callback being invoked
      configStoreCallback.current?.();

      expect(fn).toHaveBeenCalled();
      unsub();
    });

    it('unsubscribing removes listener', () => {
      const fn = vi.fn();
      const unsub = providerStore.subscribe(fn);
      unsub();

      configStoreCallback.current?.();

      expect(fn).not.toHaveBeenCalled();
    });
  });
});
