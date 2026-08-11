/**
 * internal-apps/devops/agent/appAdapter.ts — DevOps backend adapter
 *
 * Wraps AppApiClient into the DevOpsAdapter interface so agent tools
 * can call the backend without depending on apiClient directly.
 */

import type { AppApiClient } from '@agent-type';
import type { DevOpsAdapter, AdoProxyCallParams, AdoProxyUploadParams, PublicKeyInfo } from '../ui/types';

/**
 * Create a DevOpsAdapter backed by the app's pre-bound AppApiClient.
 *
 * @param apiClient  Pre-bound AppApiClient (app id already bound).
 */
export function createDevopsAppAdapter(apiClient: AppApiClient): DevOpsAdapter {
  return {
    async callAdoProxy<T>(params: AdoProxyCallParams): Promise<T> {
      return apiClient.call<T>('callAdoProxy', params as unknown as Record<string, unknown>);
    },

    async uploadAdoProxy<T>(params: AdoProxyUploadParams): Promise<T> {
      return apiClient.call<T>('uploadAdoProxy', params as unknown as Record<string, unknown>);
    },

    async getPublicKey(): Promise<PublicKeyInfo> {
      return apiClient.call<PublicKeyInfo>('getPublicKey');
    },
  };
}
