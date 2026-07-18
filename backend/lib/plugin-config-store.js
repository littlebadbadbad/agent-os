/**
 * backend/lib/plugin-config-store.js — Persisted plugin configuration store.
 *
 * Each plugin has a JSON file at <dataRoot>/plugin-data/<id>/config.json
 * that stores the user's configuration overrides.
 *
 * The store handles:
 *   - Loading saved config (returns empty object on first access)
 *   - Saving updated config
 *   - Merging saved config with manifest defaults
 *
 * Usage:
 *   import { createPluginConfigStore } from './plugin-config-store.js';
 *   const store = createPluginConfigStore(dataRoot);
 *   const config = store.load('browser', manifest);
 */

/** @import { PluginManifest } from '../../agent-type/plugin.ts' */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('plugin-config-store');

/**
 * Create a plugin config store bound to a data root directory.
 *
 * @param {string} dataRoot - Absolute path to the data/ directory.
 * @returns {{
 *   load: (pluginId: string, manifest?: object) => Record<string, unknown>,
 *   save: (pluginId: string, config: Record<string, unknown>) => void,
 *   getConfigPath: (pluginId: string) => string,
 * }}
 */
export function createPluginConfigStore(dataRoot) {
  /**
   * Get the path to a plugin's config file.
   * @param {string} pluginId
   * @returns {string}
   */
  function getConfigPath(pluginId) {
    return join(dataRoot, 'plugin-data', pluginId, 'config.json');
  }

  /**
   * Load a plugin's saved config, merged with manifest defaults.
   *
   * @param {string} pluginId
   * @param {PluginManifest} [manifest]
   * @returns {Record<string, unknown>}
   */
  function load(pluginId, manifest) {
    // Compute defaults from manifest configuration schema.
    const defaults = computeDefaults(manifest);

    // Load saved config from disk.
    const configPath = getConfigPath(pluginId);
    let saved = {};
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        saved = JSON.parse(raw);
      } catch (err) {
        log.warn(`Failed to parse config for "${pluginId}": ${err.message}`);
      }
    }

    // Merge: saved overrides defaults.
    return { ...defaults, ...saved };
  }

  /**
   * Save (persist) a plugin's config.
   *
   * @param {string} pluginId
   * @param {Record<string, unknown>} config
   */
  function save(pluginId, config) {
    const configPath = getConfigPath(pluginId);

    // Ensure plugin data directory exists.
    const dir = join(configPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      log.debug(`Config saved for "${pluginId}"`);
    } catch (err) {
      log.error(`Failed to save config for "${pluginId}": ${err.message}`);
    }
  }

  return { load, save, getConfigPath };
}

// ── Defaults computation ─────────────────────────────────────────────────────

/**
 * Compute the default configuration from the manifest's configuration schema.
 *
 * @param {PluginManifest} [manifest]
 * @returns {Record<string, unknown>}
 */
function computeDefaults(manifest) {
  if (!manifest || !manifest.configuration || !manifest.configuration.properties) {
    return {};
  }

  const result = {};
  const props = manifest.configuration.properties;

  for (const [key, propDef] of Object.entries(props)) {
    if (propDef && typeof propDef === 'object' && 'default' in propDef) {
      deepSet(result, key, propDef.default);
    }
  }

  return result;
}

/**
 * Deep-set a value by dot-separated key path.
 *
 * @param {Record<string, unknown>} obj
 * @param {string} path
 * @param {unknown} value
 */
function deepSet(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}
