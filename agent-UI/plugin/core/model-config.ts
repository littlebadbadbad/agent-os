/**
 * agent-UI/plugin/core/model-config.ts — Super built-in "model-config" plugin API
 *
 * Typed wrappers around the model configuration CRUD backend API.
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 */

import { createPluginApiClient } from '../apiClient';
import type { ProviderEntry } from '../../store/providerConfigStore';

const client = createPluginApiClient('model-config');

export async function fetchMergedModelConfig(): Promise<ProviderEntry[]> {
  const res = await client.call<readonly ProviderEntry[]>('get');
  return Array.isArray(res) ? (res as ProviderEntry[]) : [];
}

export async function fetchBuiltInModelConfig(): Promise<ProviderEntry[]> {
  const res = await client.call<readonly ProviderEntry[]>('getBuiltIn');
  return Array.isArray(res) ? (res as ProviderEntry[]) : [];
}

export async function fetchCustomModelConfig(): Promise<ProviderEntry[]> {
  const res = await client.call<readonly ProviderEntry[]>('getCustom');
  return Array.isArray(res) ? (res as ProviderEntry[]) : [];
}

export async function saveCustomModelConfig(config: ProviderEntry[]): Promise<void> {
  await client.call('saveCustom', config as unknown as Record<string, unknown>);
}

export async function addCustomModelProvider(entry: ProviderEntry): Promise<void> {
  await client.call('addCustom', entry as unknown as Record<string, unknown>);
}

export async function removeCustomModelProvider(name: string): Promise<void> {
  await client.call('removeCustom', { name });
}

export async function updateCustomModelProvider(name: string, entry: ProviderEntry): Promise<void> {
  await client.call('updateCustom', { name, entry });
}
