/**
 * backend/lib/plugin-host.js — Creates sandboxed BackendPluginHost instances.
 *
 * Each plugin activation gets its own host object that is the plugin's only
 * window into the core system. The host provides:
 *   - defineApi / defineStream: register endpoints via the shared router
 *   - getPluginDataDir: scoped writable directory for the plugin
 *   - getPluginPath: security-gated access to system paths
 *
 * Security model:
 *   Plugin code can only interact with the system through the host API.
 *   Path access is restricted — only the plugin-manager plugin can see PLUGINS_DIR.
 *
 * Usage:
 *   import { createPluginHost } from './plugin-host.js';
 *   const host = createPluginHost('browser', manifest, router, pluginsDir);
 */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { createLogger } from './logger.js';

const log = createLogger('plugin-host');

/**
 * Map of backend service accessors exposed via `host.getBackendConfig(key)`.
 * Extend this to expose more backend capabilities to plugins.
 *
 * @typedef {Object} BackendServices
 * @property {() => import('../../agent-type/plugin.ts').ProxyConfig} [proxy]  - Current proxy configuration.
 */

/**
 * Create a BackendPluginHost for a given plugin.
 *
 * @param {string} pluginId   - Unique plugin identifier (kebab-case, matches manifest.id).
 * @param {import('../../agent-type/plugin.ts').PluginManifest} manifest - Parsed plugin manifest.
 * @param {import('./plugin-router.js').pluginRouter} router - Shared plugin router instance.
 * @param {string} pluginsDir   - Absolute path to the plugins directory.
 * @param {string} dataRoot     - Absolute path to the data root directory (for plugin data dirs).
 * @param {BackendServices} [backendServices]  - Optional map of backend service accessors.
 * @param {string} [agentDir]   - Absolute path to the `.agent/` directory.
 * @returns {import('../../agent-type/plugin.ts').BackendPluginHost}
 */
export function createPluginHost(pluginId, manifest, router, pluginsDir, dataRoot, backendServices = {}, agentDir = null) {
  const pluginDataDir = join(dataRoot, 'plugin-data', pluginId);

  // Ensure the plugin's data directory exists.
  if (!existsSync(pluginDataDir)) {
    mkdirSync(pluginDataDir, { recursive: true });
  }

  /** Lazily-created logger — namespace = pluginId. */
  let _logger = null;

  const host = {
    /** Structured logger scoped to this plugin (created on first access). */
    get logger() {
      if (!_logger) _logger = createLogger(pluginId);
      return _logger;
    },

    defineApi(method, handler) {
      if (typeof method !== 'string') {
        log.error(`defineApi: method must be a string, got ${typeof method}`);
        return;
      }
      if (typeof handler !== 'function') {
        log.error(`defineApi: handler must be a function, got ${typeof handler}`);
        return;
      }
      router.registerApi(pluginId, method, handler);
    },

    defineStream(name, handler) {
      if (typeof name !== 'string') {
        log.error(`defineStream: name must be a string, got ${typeof name}`);
        return;
      }
      if (typeof handler !== 'function') {
        log.error(`defineStream: handler must be a function, got ${typeof handler}`);
        return;
      }
      router.registerStream(pluginId, name, handler);
    },

    getPluginDataDir() {
      return pluginDataDir;
    },

    getAgentDir() {
      return agentDir;
    },

    getBackendConfig(key) {
      if (typeof key !== 'string') {
        log.error(`getBackendConfig: key must be a string, got ${typeof key}`);
        return undefined;
      }
      const accessor = backendServices[key];
      if (typeof accessor !== 'function') {
        log.warn(`getBackendConfig: unknown key "${key}" — no accessor registered`);
        return undefined;
      }
      return accessor();
    },
  };

  return host;
}
