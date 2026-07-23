/**
 * agent-UI/api/backend.ts — Backend API adapter for agent-related services
 *
 * PURE BUSINESS LOGIC — ZERO communication code.
 * All API calls delegated to super built-in plugin clients in plugin/core/.
 *
 * Legacy file — prefer importing directly from plugin/core/ for new code.
 * Kept for convenience re-exports.
 */

export {
  fetchPublicKey,
  getProxyConfig,
  updateProxyConfig,
  loadSessions,
  saveSessions,
} from '../plugin/core';

export type { PublicKeyInfo } from '../plugin/core';

// ── API keys (still use apiTransport — will be migrated to a core plugin) ────

import { createPluginApiClient } from '../plugin/apiClient';

const keysClient = createPluginApiClient('api-keys');

export interface MaskedKeys {
  keys: Record<string, string | null>;
}

export async function fetchApiKeys(): Promise<MaskedKeys> {
  return keysClient.call<MaskedKeys>('list');
}

export async function saveApiKey(providerId: string, encryptedKey: string): Promise<{ masked: string }> {
  return keysClient.call<{ masked: string }>('save', { providerId, encryptedKey });
}

export async function deleteApiKey(providerId: string): Promise<void> {
  await keysClient.call('delete', { providerId });
}
