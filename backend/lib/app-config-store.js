/**
 * backend/lib/app-config-store.js — Persisted app configuration store.
 *
 * Each app has a JSON file at <dataRoot>/app-data/<id>/config.json
 * that stores the user's configuration overrides.
 *
 * The store handles:
 *   - Loading saved config (returns empty object on first access)
 *   - Saving updated config
 *   - Merging saved config with manifest defaults
 *
 * Usage:
 *   import { createAppConfigStore } from './app-config-store.js';
 *   const store = createAppConfigStore(dataRoot);
 *   const config = store.load('browser', manifest);
 */

/** @import { AppManifest } from '../../agent-type/app.ts' */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('app-config-store');

/**
 * Create a app config store bound to a data root directory.
 *
 * @param {string} dataRoot - Absolute path to the data/ directory.
 * @returns {{
 *   load: (appId: string, manifest?: object) => Record<string, unknown>,
 *   save: (appId: string, config: Record<string, unknown>) => void,
 *   getConfigPath: (appId: string) => string,
 * }}
 */
export function createAppConfigStore(dataRoot) {
  /**
   * Get the path to a app's config file.
   * @param {string} appId
   * @returns {string}
   */
  function getConfigPath(appId) {
    return join(dataRoot, 'app-data', appId, 'config.json');
  }

  /**
   * Load a app's saved config, merged with manifest defaults.
   *
   * @param {string} appId
   * @param {AppManifest} [manifest]
   * @returns {Record<string, unknown>}
   */
  function load(appId, manifest) {
    // Compute defaults from manifest configuration schema.
    const defaults = computeDefaults(manifest);

    // Load saved config from disk.
    const configPath = getConfigPath(appId);
    let saved = {};
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        saved = JSON.parse(raw);
      } catch (err) {
        log.warn(`Failed to parse config for "${appId}": ${err.message}`);
      }
    }

    // Merge: saved overrides defaults.
    return { ...defaults, ...saved };
  }

  /**
   * Save (persist) a app's config.
   *
   * @param {string} appId
   * @param {Record<string, unknown>} config
   */
  function save(appId, config) {
    const configPath = getConfigPath(appId);

    // Ensure app data directory exists.
    const dir = join(configPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      log.debug(`Config saved for "${appId}"`);
    } catch (err) {
      log.error(`Failed to save config for "${appId}": ${err.message}`);
    }
  }

  return { load, save, getConfigPath };
}

// ── Defaults computation ─────────────────────────────────────────────────────

/**
 * Compute the default configuration from the manifest's configuration schema.
 *
 * @param {AppManifest} [manifest]
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
