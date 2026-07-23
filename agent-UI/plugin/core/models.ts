/**
 * agent-UI/plugin/core/models.ts — Super built-in "models" plugin API
 *
 * Typed wrappers around the model listing backend API.
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 */

import { createPluginApiClient } from '../apiClient';

const client = createPluginApiClient('models');

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly maxTokens?: number;
}

export async function listModels(provider?: string): Promise<readonly ModelInfo[]> {
  return client.call<readonly ModelInfo[]>('list', { provider });
}
