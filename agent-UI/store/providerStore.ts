/**
 * Shared provider store — thin facade over providerConfigStore.
 *
 * Converts providerConfigStore's { providerName, modelId } naming to
 * the handler-friendly { providerId, modelId } naming used by
 * asyncHandler and streamHandler.
 *
 * Follows the useSyncExternalStore subscriber contract so React components
 * can subscribe to changes without any extra state management library.
 */

import { providerConfigStore } from './providerConfigStore';
import type { ModelMeta } from '@agent-type';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Provider = string;

export type ProviderSelection = {
  providerId: Provider;
  modelId: string;
};

// ── Store singleton ───────────────────────────────────────────────────────────

let current: ProviderSelection = {
  providerId: '',
  modelId: '',
};

const subscribers = new Set<() => void>();

function syncFromConfig(): void {
  const sel = providerConfigStore.getSelection();
  current = {
    providerId: sel.providerName,
    modelId: sel.modelId,
  };
}

// Subscribe to config store changes
providerConfigStore.subscribe(() => {
  syncFromConfig();
  subscribers.forEach((fn) => fn());
});

export const providerStore = {
  /** Returns the active provider name. */
  get(): Provider {
    return current.providerId;
  },
  /** Returns the full { providerId, modelId } selection. */
  getSelection(): ProviderSelection {
    return current;
  },
  /** Sets provider+model atomically. */
  setSelection(sel: ProviderSelection): void {
    current = sel;
    providerConfigStore.setSelection({ providerName: sel.providerId, modelId: sel.modelId });
    subscribers.forEach((fn) => fn());
  },
  /** Returns a ModelMeta for the currently selected model, with contextWindow from config. */
  getSelectedModel(): ModelMeta {
    const sel = current;
    const provider = providerConfigStore.getProvider(sel.providerId);
    const model = provider?.models.find((m) => m.id === sel.modelId);
    const contextWindow = model?.maxInputTokens ?? 0;
    return { id: sel.modelId, label: sel.modelId, contextWindow, description: '' };
  },
  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};

