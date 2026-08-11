/**
 * agent-UI/app/core/models.ts — Super built-in "models" app API
 *
 * Typed wrappers around the model listing backend API.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 */

import { createAppApiClient } from '../apiClient';

const client = createAppApiClient('models');

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly maxTokens?: number;
}

export async function listModels(provider?: string): Promise<readonly ModelInfo[]> {
  return client.call<readonly ModelInfo[]>('list', { provider });
}
