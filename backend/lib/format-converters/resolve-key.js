/**
 * backend/lib/format-converters/resolve-key.js — API key resolution
 *
 * Extracted from the original customendpoint.js for reuse across
 * all format converters.
 */

import { getApiKey } from '../key-store.js';

/**
 * Resolve the API key for a given provider name.
 * Falls through: runtime key → env var → null
 *
 * @param {string} providerName
 * @returns {string|null}
 */
export function resolveApiKey(providerName) {
  // Try runtime key store first
  const runtimeKey = getApiKey(providerName);
  if (runtimeKey) return runtimeKey;

  // Fall back to env var conventions (backward compat)
  const envMap = {
    deepseek: 'DEEPSEEK_API_KEY',
    doubao: 'DOUBAO_API_KEY',
    qwen: 'QWEN_API_KEY',
    glm: 'GLM_API_KEY',
    openai: 'OPENAI_API_KEY',
    'GLM Internal': 'GLM_API_KEY',
    'United Imaging': 'GLM_API_KEY',
    '火山方舟': 'DOUBAO_API_KEY',
  };
  const envVar = envMap[providerName];
  if (envVar && process.env[envVar]) return process.env[envVar];

  return null;
}
