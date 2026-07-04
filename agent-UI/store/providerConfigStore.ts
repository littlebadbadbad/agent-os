/**
 * agent-UI/store/providerConfigStore.ts — Config-driven provider store
 *
 * Single source of truth for provider/model selection.
 * Supports TWO-LAYER config:
 *   1. Built-in: static, shipped with the app (read-only)
 *   2. Custom: user-editable, persisted in data/custom-provider-config.json
 *
 * The store always load the MERGED config (built-in + custom, custom wins).
 * The legacy load() still works and returns the merged config for backward compat.
 */

import {
  fetchMergedModelConfig,
  fetchBuiltInModelConfig,
  fetchCustomModelConfig,
  saveCustomModelConfig,
  addCustomModelProvider,
  removeCustomModelProvider,
} from '../api/providerConfigApi';

// ── Types (mirror the JSON config structure) ─────────────────────────────────

/**
 * Supported AI API wire formats.
 * - 'chat-completions' — OpenAI Chat Completions (POST /v1/chat/completions)
 * - 'messages'         — Anthropic Messages (POST /v1/messages)
 * - 'responses'        — OpenAI Responses (POST /v1/responses)
 */
export type ApiType = 'chat-completions' | 'messages' | 'responses';

/** All valid ApiType values, useful for dropdown rendering. */
export const API_TYPES: ApiType[] = ['chat-completions', 'messages', 'responses'];

export interface ProviderModelConfig {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface ProviderEntry {
  readonly name: string;
  readonly vendor: string;
  readonly apiKey: string;
  readonly apiType: ApiType;
  readonly models: readonly ProviderModelConfig[];
}

export interface ProviderSelection {
  providerName: string;
  modelId: string;
}

// ── Store state ──────────────────────────────────────────────────────────────

type ConfigState = {
  /** Merged provider list (built-in + custom). Used for display and selection. */
  providers: ProviderEntry[];
  /** Built-in providers only (read-only baseline). */
  builtInProviders: ProviderEntry[];
  /** Custom providers only (user-editable overrides). */
  customProviders: ProviderEntry[];
  loaded: boolean;
  selection: ProviderSelection;
};

let state: ConfigState = {
  providers: [],
  builtInProviders: [],
  customProviders: [],
  loaded: false,
  selection: {
    providerName: '',
    modelId: '',
  },
};

const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

// ── Store API ────────────────────────────────────────────────────────────────

export const providerConfigStore = {
  /** Load the MERGED provider config from the backend (built-in + custom). */
  async load(): Promise<void> {
    try {
      const [providers, builtIn, custom] = await Promise.all([
        fetchMergedModelConfig(),
        fetchBuiltInModelConfig(),
        fetchCustomModelConfig(),
      ]);
      state = {
        providers,
        builtInProviders: builtIn,
        customProviders: custom,
        loaded: true,
        selection: state.selection.providerName
          ? state.selection
          : providers.length > 0
            ? {
                providerName: providers[0].name,
                modelId: providers[0].models[0]?.id ?? '',
              }
            : { providerName: '', modelId: '' },
      };
      notify();
    } catch {
      // If config can't be loaded, keep previous state
      state = { ...state, loaded: true };
      notify();
    }
  },

  /** Get the full merged provider list. */
  getProviders(): ProviderEntry[] {
    return state.providers;
  },

  /** Get the built-in provider list only (read-only). */
  getBuiltInProviders(): ProviderEntry[] {
    return state.builtInProviders;
  },

  /** Get the custom provider list only (user-editable). */
  getCustomProviders(): ProviderEntry[] {
    return state.customProviders;
  },

  /** Get a specific provider by name from the MERGED config. */
  getProvider(name: string): ProviderEntry | undefined {
    return state.providers.find((p) => p.name === name);
  },

  /** Get models for a provider from the MERGED config. */
  getModels(providerName: string): readonly ProviderModelConfig[] {
    const provider = this.getProvider(providerName);
    return provider?.models ?? [];
  },

  /** Get the currently selected provider entry. */
  getSelectedProvider(): ProviderEntry | undefined {
    return this.getProvider(state.selection.providerName);
  },

  /** Get the currently selected model config. */
  getSelectedModel(): ProviderModelConfig | undefined {
    const provider = this.getSelectedProvider();
    return provider?.models.find((m) => m.id === state.selection.modelId);
  },

  /** Get the full current selection. */
  getSelection(): ProviderSelection {
    return state.selection;
  },

  /** Get provider name (backward compat with handler code). */
  getProviderName(): string {
    return state.selection.providerName;
  },

  /** Set provider + model atomically. */
  setSelection(sel: ProviderSelection): void {
    state = { ...state, selection: sel };
    notify();
  },

  /**
   * Replace the full provider list and persist to backend.
   * NOTE: This saves to the CUSTOM config only (built-in is read-only).
   * The providers passed here should represent the desired custom config.
   */
  async saveProviders(providers: ProviderEntry[]): Promise<void> {
    await saveCustomModelConfig(providers);
    state = {
      ...state,
      customProviders: providers,
      // Re-derive the merged config: start with built-in, override with custom
      providers: mergeProviders(state.builtInProviders, providers),
    };
    notify();
  },

  /**
   * Reload only the custom config from the backend and re-merge.
   * Useful after direct file editing.
   */
  async reloadCustom(): Promise<void> {
    try {
      const custom = await fetchCustomModelConfig();
      state = {
        ...state,
        customProviders: custom,
        providers: mergeProviders(state.builtInProviders, custom),
      };
      notify();
    } catch {
      // keep previous state
    }
  },

  /**
   * Reload the built-in config from the backend and re-merge.
   * Useful after application updates.
   */
  async reloadBuiltIn(): Promise<void> {
    try {
      const builtIn = await fetchBuiltInModelConfig();
      state = {
        ...state,
        builtInProviders: builtIn,
        providers: mergeProviders(builtIn, state.customProviders),
      };
      notify();
    } catch {
      // keep previous state
    }
  },

  /** Subscribe to store changes. */
  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  /** Whether config has been loaded. */
  isLoaded(): boolean {
    return state.loaded;
  },

  /**
   * Reset the store to initial state.
   * Used in tests for isolation between test cases.
   */
  _reset(): void {
    state = {
      providers: [],
      builtInProviders: [],
      customProviders: [],
      loaded: false,
      selection: { providerName: '', modelId: '' },
    };
  },
};

// ── Merge helper ──────────────────────────────────────────────────────────────

/**
 * Merge two provider lists: built-in + custom.
 * Custom providers with the same name override built-in ones.
 * Custom-only providers (names not in built-in) are appended.
 */
function mergeProviders(builtIn: ProviderEntry[], custom: ProviderEntry[]): ProviderEntry[] {
  const mergedByName = new Map<string, ProviderEntry>();
  for (const p of builtIn) {
    mergedByName.set(p.name, { ...p });
  }
  for (const p of custom) {
    mergedByName.set(p.name, { ...p });
  }
  return Array.from(mergedByName.values());
}
