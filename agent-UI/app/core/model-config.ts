/**
 * agent-UI/app/core/model-config.ts — Super built-in "model-config" app API
 *
 * Typed wrappers around the model configuration CRUD backend API.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 */

import { createAppApiClient } from '../apiClient';
import type { ProviderEntry } from '../../store/providerConfigStore';

const client = createAppApiClient('model-config');

export async function fetchMergedModelConfig(): Promise<ProviderEntry[]> {
  const res = await client.call<readonly ProviderEntry[]>('get');
  return Array.isArray(res) ? [...res] : [];
}

export async function fetchBuiltInModelConfig(): Promise<ProviderEntry[]> {
  const res = await client.call<readonly ProviderEntry[]>('getBuiltIn');
  return Array.isArray(res) ? [...res] : [];
}

export async function fetchCustomModelConfig(): Promise<ProviderEntry[]> {
  const res = await client.call<readonly ProviderEntry[]>('getCustom');
  return Array.isArray(res) ? [...res] : [];
}

export async function saveCustomModelConfig(config: ProviderEntry[]): Promise<void> {
  await client.call('saveCustom', { config });
}

export async function addCustomModelProvider(entry: ProviderEntry): Promise<void> {
  await client.call('addCustom', { entry });
}

export async function removeCustomModelProvider(name: string): Promise<void> {
  await client.call('removeCustom', { name });
}

export async function updateCustomModelProvider(name: string, entry: ProviderEntry): Promise<void> {
  await client.call('updateCustom', { name, entry });
}
