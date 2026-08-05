/**
 * internal-plugins/devops/agent/pluginAdapter.ts — DevOps backend adapter
 *
 * Wraps PluginApiClient into the DevOpsAdapter interface so agent tools
 * can call the backend without depending on apiClient directly.
 */

import type { PluginApiClient } from '@agent-type';
import type { DevOpsAdapter, AdoProxyCallParams, AdoProxyUploadParams, PublicKeyInfo } from '../ui/types';

/**
 * Create a DevOpsAdapter backed by the plugin's pre-bound PluginApiClient.
 *
 * @param apiClient  Pre-bound PluginApiClient (plugin id already bound).
 */
export function createDevopsPluginAdapter(apiClient: PluginApiClient): DevOpsAdapter {
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
