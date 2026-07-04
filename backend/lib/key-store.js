/**
 * Runtime API key store with persistent encryption at rest.
 *
 * ── Data flow ──────────────────────────────────────────────────────────────
 *
 * 1. User enters API key in the ProviderSelector UI.
 * 2. Frontend RSA-encrypts the key with the per-session server public key.
 * 3. Backend RSA-decrypts the key (see `services/api-keys.js`).
 * 4. Backend re-encrypts with AES-256-GCM and writes to .agent/api-keys.json.
 * 5. On next startup, the encrypted file is read and decrypted automatically.
 *
 * Priority chain:  persisted key  >  env var  >  null
 *
 * The frontend NEVER sends API keys with chat requests — the backend looks up
 * keys by provider ID from this store.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 *
 * - Keys at rest are encrypted with AES-256-GCM (see key-encryption.js).
 * - The .agent/ directory is gitignored — never committed to version control.
 * - The RSA key pair used for transport is ephemeral (regenerated on each
 *   server start), so RSA-encrypted payloads are never persisted.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AGENT_DIR } from './paths.js';
import { encrypt, decrypt } from './key-encryption.js';
import { createLogger } from './logger.js';

const log = createLogger('key-store');

const STORE_FILE = join(AGENT_DIR, 'api-keys.json');

/** @type {Map<string, string>} provider id → plaintext API key */
const _keys = new Map();

/** Canonical env var names for each provider — fallback only, not a hardcoded list */
const ENV_VAR = {
  doubao:   'DOUBAO_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  qwen:     'QWEN_API_KEY',
  glm:      'GLM_API_KEY',
  openai:   'OPENAI_API_KEY',
};

// ── Persistence ───────────────────────────────────────────────────────────────

/** Load encrypted keys from .agent/api-keys.json into memory. */
function loadPersistedKeys() {
  if (!existsSync(STORE_FILE)) return;
  try {
    const raw = readFileSync(STORE_FILE, 'utf8');
    const encryptedData = JSON.parse(raw);
    let loaded = 0;
    for (const [providerId, encryptedKey] of Object.entries(encryptedData)) {
      const plain = decrypt(encryptedKey);
      if (plain !== null) {
        _keys.set(providerId, plain);
        loaded++;
      }
    }
    if (loaded > 0) log.info(`Loaded ${loaded} API key(s) from .agent/api-keys.json`);
  } catch (err) {
    log.warn('Failed to load persisted API keys —', err.message);
  }
}

/** Persist all in-memory keys to .agent/api-keys.json (AES-256-GCM encrypted). */
function persistKeys() {
  try {
    const data = {};
    for (const [providerId, plainKey] of _keys) {
      data[providerId] = encrypt(plainKey);
    }
    writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    log.error('Failed to persist API keys —', err.message);
  }
}

// Load persisted keys on module initialisation.
loadPersistedKeys();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the API key for a provider, or null if unset.
 * @param {string} providerId
 * @returns {string|null}
 */
export function getApiKey(providerId) {
  if (_keys.has(providerId)) return _keys.get(providerId);
  // Check canonical env var first
  const canon = process.env[ENV_VAR[providerId]];
  if (canon) return canon;
  // Fallback: check <NAME>_API_KEY convention for any provider
  const upperName = providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const conventional = process.env[`${upperName}_API_KEY`];
  if (conventional) return conventional;
  return null;
}

/**
 * Stores a plaintext API key for a provider at runtime.
 * Persists to .agent/api-keys.json immediately.
 *
 * @param {string} providerId
 * @param {string} plainKey
 */
export function setApiKey(providerId, plainKey) {
  _keys.set(providerId, plainKey.trim());
  persistKeys();
}

/**
 * Removes a runtime-set key (falls back to env var).
 * Persists the change to .agent/api-keys.json immediately.
 *
 * @param {string} providerId
 */
export function deleteApiKey(providerId) {
  _keys.delete(providerId);
  persistKeys();
}

/**
 * Returns a summary of all provider key statuses with values masked.
 * @returns {Record<string, string|null>}
 */
export function listApiKeys() {
  // Return both runtime-stored keys AND env var keys
  const result = {};
  // Runtime keys (from .agent/api-keys.json)
  for (const [providerId, plain] of _keys) {
    result[providerId] = `••••${plain.slice(-4)}`;
  }
  // Env var fallbacks not already covered
  for (const [providerId, envVar] of Object.entries(ENV_VAR)) {
    if (!result[providerId] && process.env[envVar]) {
      const val = process.env[envVar];
      result[providerId] = `••••${val.slice(-4)}`;
    }
  }
  return result;
}
