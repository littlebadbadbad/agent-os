/**
 * agent-UI/app/core/system.ts — Super built-in "system" app API
 *
 * Typed wrappers around the system's backend API methods.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 */

import { createAppApiClient } from '../apiClient';

const client = createAppApiClient('system');

export interface PublicKeyInfo {
  readonly publicKey: string;
}

export async function fetchPublicKey(): Promise<PublicKeyInfo> {
  return client.call<PublicKeyInfo>('publicKey');
}

export async function checkHealth(): Promise<{ status: string }> {
  return client.call<{ status: string }>('health');
}
