/**
 * agent-UI/plugin/core/system.ts — Super built-in "system" plugin API
 *
 * Typed wrappers around the system's backend API methods.
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 */

import { createPluginApiClient } from '../apiClient';

const client = createPluginApiClient('system');

export interface PublicKeyInfo {
  readonly publicKey: string;
}

export async function fetchPublicKey(): Promise<PublicKeyInfo> {
  return client.call<PublicKeyInfo>('publicKey');
}

export async function checkHealth(): Promise<{ status: string }> {
  return client.call<{ status: string }>('health');
}
