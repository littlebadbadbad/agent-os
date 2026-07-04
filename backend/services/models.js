/**
 * backend/lib/services/models.js — Model listing service
 *
 * Reads models from data/provider-config.json — no more API calls.
 * Models can only be configured via the config file or the provider-config
 * management endpoints.
 */

import { getMergedProvider, listMergedModelsForProvider, listMergedProviderNames } from './model-config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('models-service');

/**
 * List models for a given provider name.
 *
 * @param {string} providerName
 * @returns {{ provider: string, models: Array<{ id: string, name: string, url: string, toolCalling: boolean, vision: boolean, maxInputTokens: number, maxOutputTokens: number }> }}
 * @throws {Error} if providerName is missing or unknown
 */
export async function listModels(providerName) {
  if (!providerName) {
    // Return ALL providers' models if no specific provider is given
    const providers = listMergedProviderNames();
    const allModels = {};
    for (const name of providers) {
      allModels[name] = listMergedModelsForProvider(name);
    }
    return { providers: allModels };
  }

  const provider = getMergedProvider(providerName);
  if (!provider) {
    throw new Error(`Unknown provider "${providerName}". Available: ${listMergedProviderNames().join(', ')}`);
  }

  const models = listMergedModelsForProvider(providerName);
  log.info(`listing models for provider: ${providerName} — ${models.length} configured`);
  return { provider: providerName, models };
}
