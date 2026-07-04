/**
 * backend/lib/services/api-keys.js — API key management business logic
 *
 * Centralises provider key management: decryption, storage, masking.
 *
 * Valid provider names are read dynamically from provider-config.json,
 * so adding a new provider in the config automatically allows setting keys.
 */

import { decryptPat } from '../lib/rsa.js';
import { getApiKey, setApiKey, deleteApiKey, listApiKeys } from '../lib/key-store.js';
import { listMergedProviderNames } from './model-config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('api-keys-service');

/**
 * Get the set of valid provider names from the config file.
 * @returns {Set<string>}
 */
function getValidProviders() {
  return new Set(listMergedProviderNames());
}

/**
 * Return masked status of all provider API keys.
 *
 * @returns {{ keys: Record<string, string|null> }}
 */
export function getKeyList() {
  return { keys: listApiKeys() };
}

/**
 * Decrypt and store a provider API key.
 *
 * @param {string} providerId   - one of VALID_PROVIDERS
 * @param {string} encryptedKey - RSA-OAEP encrypted base64 key
 * @returns {{ ok: true, masked: string }}
 * @throws {Error} if validation fails or decryption fails
 */
export function saveKey(providerId, encryptedKey) {
  const valid = getValidProviders();
  if (!providerId || !valid.has(providerId)) {
    throw new Error(`Invalid providerId. Must be one of: ${[...valid].join(', ')}`);
  }
  if (!encryptedKey || typeof encryptedKey !== 'string') {
    throw new Error('encryptedKey is required');
  }

  let plainKey;
  try {
    plainKey = decryptPat(encryptedKey);
  } catch (err) {
    log.warn('API key decryption failed', err.message);
    throw new Error('Failed to decrypt key. Ensure it was encrypted with the current server public key.');
  }

  if (!plainKey.trim()) throw new Error('Decrypted key is empty');

  setApiKey(providerId, plainKey);
  log.info(`API key set for provider: ${providerId}`);
  return { ok: true, masked: `••••${plainKey.slice(-4)}` };
}

/**
 * Remove a runtime-set key (falls back to env var).
 *
 * @param {string} providerId - one of VALID_PROVIDERS
 * @returns {{ ok: true }}
 * @throws {Error} if providerId is invalid
 */
export function removeKey(providerId) {
  const valid = getValidProviders();
  if (!valid.has(providerId)) {
    throw new Error('Invalid providerId');
  }
  deleteApiKey(providerId);
  log.info(`API key cleared for provider: ${providerId}`);
  return { ok: true };
}
