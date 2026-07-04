/**
 * agent-UI/api/providerConfigApi.ts — Provider config API adapter
 *
 * CRUD operations for the two-layer model config system:
 *   - Built-in: static, read-only, shipped with the app
 *   - Custom: user-editable, persisted in data/custom-provider-config.json
 *   - Merged: built-in + custom combined (custom overrides built-in on name conflict)
 *
 * All HTTP/IPC details delegated to apiTransport.
 */

import { apiTransport } from '../transport/apiTransport';
import type { ProviderEntry } from '../store/providerConfigStore';

// ── Model config (built-in + custom) ──────────────────────────────────────────

/**
 * Fetch the MERGED model config (built-in + custom).
 */
export async function fetchMergedModelConfig(): Promise<ProviderEntry[]> {
  const res = await apiTransport.get<ProviderEntry[]>('/api/model-config');
  return Array.isArray(res) ? res : [];
}

/**
 * Fetch the BUILT-IN model config only.
 */
export async function fetchBuiltInModelConfig(): Promise<ProviderEntry[]> {
  const res = await apiTransport.get<ProviderEntry[]>('/api/model-config/built-in');
  return Array.isArray(res) ? res : [];
}

/**
 * Fetch the CUSTOM model config only.
 */
export async function fetchCustomModelConfig(): Promise<ProviderEntry[]> {
  const res = await apiTransport.get<ProviderEntry[]>('/api/model-config/custom');
  return Array.isArray(res) ? res : [];
}

/**
 * Overwrite the entire CUSTOM model config.
 */
export async function saveCustomModelConfig(config: ProviderEntry[]): Promise<void> {
  await apiTransport.put('/api/model-config/custom', config);
}

/**
 * Add a new provider entry to the CUSTOM model config.
 */
export async function addCustomModelProvider(entry: ProviderEntry): Promise<void> {
  await apiTransport.post('/api/model-config/custom/add', entry);
}

/**
 * Remove a provider by name from the CUSTOM model config.
 */
export async function removeCustomModelProvider(name: string): Promise<void> {
  await apiTransport.post('/api/model-config/custom/remove', { name });
}

/**
 * Update (replace) a provider in the CUSTOM model config.
 * If the provider doesn't exist in custom config, it will be added.
 */
export async function updateCustomModelProvider(name: string, entry: ProviderEntry): Promise<void> {
  await apiTransport.post('/api/model-config/custom/update', { name, entry });
}
