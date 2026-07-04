/**
 * backend/services/model-config.js — Model configuration service
 *
 * Manages TWO sources of provider/model configuration:
 *   1. Built-in config — static, read-only data/built-in-provider-config.json
 *   2. Custom config   — user-editable, persisted in data/custom-provider-config.json
 *
 * The merge logic:
 *   - Start with all built-in providers
 *   - For each custom provider with the same name, OVERRIDE the built-in entry
 *   - Custom-only providers (names not in built-in) are appended
 *   - The result is the "merged" config used by the rest of the app
 *
 * Users can ONLY edit the custom config file. Built-in config is immutable.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { DATA_ROOT } from '../lib/paths.js';
import { createLogger } from '../lib/logger.js';

// ── Built-in config — shipped as JSON, imported statically ────────────────────
// Users override entries via the custom config file, not by editing this one.
import builtInConfig from './built-in-provider-config.json' with { type: 'json' };

const log = createLogger('model-config');

// ── Custom config file path ───────────────────────────────────────────────────

const CUSTOM_CONFIG_FILE = join(DATA_ROOT, 'custom-provider-config.json');

// ── In-memory cache for custom config (reloaded on every read to support hot edits) ─

let _cachedCustom = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deep clone a plain object/array (JSON-safe only).
 * Used to return mutable copies of frozen built-in config.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Ensure the custom config file exists, creating an empty array if needed.
 */
function ensureCustomConfigFile() {
  if (existsSync(CUSTOM_CONFIG_FILE)) return;
  try {
    mkdirSync(dirname(CUSTOM_CONFIG_FILE), { recursive: true });
    writeFileSync(CUSTOM_CONFIG_FILE, JSON.stringify([], null, 2), 'utf8');
    log.info(`Created custom provider config at ${CUSTOM_CONFIG_FILE}`);
  } catch (err) {
    log.warn(`Failed to create custom provider config: ${err.message}`);
  }
}

/**
 * Parse the custom config JSON file.
 * Returns the parsed array or throws on error.
 *
 * @returns {Array<{name: string, vendor: string, apiKey: string, apiType: string, models: Array}>}
 */
function parseCustomConfig() {
  ensureCustomConfigFile();
  if (!existsSync(CUSTOM_CONFIG_FILE)) {
    throw new Error(`Custom provider config not found at ${CUSTOM_CONFIG_FILE}`);
  }
  const raw = readFileSync(CUSTOM_CONFIG_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Custom provider config must be a JSON array');
  }
  _cachedCustom = parsed;
  return parsed;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the built-in static provider config (deep-cloned to avoid mutation).
 *
 * @returns {Array}
 */
export function getBuiltInConfig() {
  return deepClone(builtInConfig);
}

/**
 * Get the custom provider config (from the custom config file).
 *
 * @returns {Array}
 */
export function getCustomConfig() {
  return parseCustomConfig();
}

/**
 * Get the MERGED provider config: built-in + custom.
 *
 * Merge rule:
 *   - Start with all built-in providers
 *   - For each custom provider with the same name, OVERRIDE the built-in entry
 *   - Custom-only providers (names not in built-in) are appended
 *
 * @returns {Array}
 */
export function getMergedConfig() {
  const builtIn = getBuiltInConfig();
  const custom = getCustomConfig();

  // Build a map of built-in providers by name
  const mergedByName = new Map();
  for (const provider of builtIn) {
    mergedByName.set(provider.name, provider);
  }

  // Apply custom overrides
  for (const customProvider of custom) {
    mergedByName.set(customProvider.name, deepClone(customProvider));
  }

  return Array.from(mergedByName.values());
}

/**
 * Get a specific provider by name from the MERGED config.
 *
 * @param {string} name
 * @returns {object|undefined}
 */
export function getMergedProvider(name) {
  return getMergedConfig().find((p) => p.name === name);
}

/**
 * Get a specific model config by provider name and model id from the MERGED config.
 *
 * @param {string} providerName
 * @param {string} modelId
 * @returns {{provider: object, model: object}|null}
 */
export function getMergedModelConfig(providerName, modelId) {
  const provider = getMergedProvider(providerName);
  if (!provider) return null;
  const model = provider.models.find((m) => m.id === modelId);
  if (!model) return null;
  return { provider, model };
}

/**
 * Overwrite the entire custom config file.
 *
 * @param {Array} config
 */
export function saveCustomConfig(config) {
  if (!Array.isArray(config)) {
    throw new Error('Custom config must be an array');
  }
  writeFileSync(CUSTOM_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  _cachedCustom = config;
  log.info('Custom provider config saved');
}

/**
 * Add a new provider entry to the custom config.
 *
 * @param {object} entry
 */
export function addCustomProvider(entry) {
  if (!entry.name || !entry.models?.length) {
    throw new Error('Provider entry must have name and at least one model');
  }
  const config = parseCustomConfig();
  if (config.find((p) => p.name === entry.name)) {
    throw new Error(`Provider "${entry.name}" already exists in custom config`);
  }
  config.push(entry);
  saveCustomConfig(config);
}

/**
 * Remove a provider entry from the custom config by name.
 *
 * @param {string} name
 */
export function removeCustomProvider(name) {
  const config = parseCustomConfig();
  const idx = config.findIndex((p) => p.name === name);
  if (idx === -1) throw new Error(`Provider "${name}" not found in custom config`);
  config.splice(idx, 1);
  saveCustomConfig(config);
}

/**
 * Update (replace) a provider entry in the custom config by name.
 * If the provider doesn't exist in custom config, it will be added.
 *
 * @param {string} name
 * @param {object} entry
 */
export function updateCustomProvider(name, entry) {
  if (!entry.name || !entry.models?.length) {
    throw new Error('Provider entry must have name and at least one model');
  }
  const config = parseCustomConfig();
  const idx = config.findIndex((p) => p.name === name);
  if (idx === -1) {
    config.push(entry);
  } else {
    config[idx] = entry;
  }
  saveCustomConfig(config);
}

/**
 * List all provider names from the MERGED config.
 *
 * @returns {string[]}
 */
export function listMergedProviderNames() {
  return getMergedConfig().map((p) => p.name);
}

/**
 * List all models for a given provider from the MERGED config.
 *
 * @param {string} providerName
 * @returns {Array}
 */
export function listMergedModelsForProvider(providerName) {
  const provider = getMergedProvider(providerName);
  if (!provider) return [];
  return provider.models;
}

/**
 * Reset the in-memory cache (used in tests for isolation).
 */
export function _resetCache() {
  _cachedCustom = null;
}
