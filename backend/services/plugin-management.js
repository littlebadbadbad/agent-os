/**
 * backend/services/plugin-management.js — Plugin management service
 *
 * Thin service layer over the plugin scanner that provides a clean API
 * for the plugin-manager plugin's backend entry to call.
 *
 * Access control: this service is only injected into the plugin-manager
 * plugin's BackendPluginHost (see plugin-host.js capability injection).
 * No other plugin can access it.
 *
 * Usage (inside plugin-manager backend activate):
 *   const svc = host.getBackendConfig('pluginManager');
 *   const plugins = svc.listPlugins();
 *   await svc.enablePlugin('todo');
 *   await svc.disablePlugin('todo');
 */

import { isBuiltInPlugin, PLUGIN_MANAGER_ID } from '../lib/plugin-scanner.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('plugin-management');

/**
 * @typedef {Object} PluginManagementService
 * @property {() => Array<{ manifest: PluginManifest, state: string, builtIn: boolean, canDisable: boolean }>} listPlugins
 * @property {(id: string) => Promise<{ ok: boolean, error?: string }>} enablePlugin
 * @property {(id: string) => Promise<{ ok: boolean, error?: string }>} disablePlugin
 * @property {(sourceType: 'zip' | 'folder', source: Buffer | string) => Promise<{ ok: boolean, error?: string, pluginId?: string }>} installPlugin
 * @property {(id: string) => Promise<{ ok: boolean, error?: string }>} uninstallPlugin
 * @property {(id: string) => Promise<{ ok: boolean, error?: string }>} reinstallBuiltInPlugin
 */

/** @import { PluginManifest } from '../../agent-type/plugin.ts' */
/** @import { pluginScanner } from '../lib/plugin-scanner.js' */

/**
 * Create a plugin management service bound to a scanner instance.
 *
 * @param {ReturnType<typeof import('../lib/plugin-scanner.js').createPluginScanner>} scanner
 * @param {() => void} [onPluginChanged]  - Optional callback fired after enable/disable (e.g. to refresh IPC handlers).
 * @returns {PluginManagementService}
 */
export function createPluginManagementService(scanner, onPluginChanged) {
  return {
    /**
     * List all plugins with their state, built-in status, and whether
     * they can be disabled.
     */
    listPlugins() {
      const plugins = scanner.getActivePlugins();
      return plugins.map((p) => ({
        manifest: p.manifest,
        state: p.state,
        builtIn: isBuiltInPlugin(p.manifest.id),
        canDisable: p.manifest.id !== PLUGIN_MANAGER_ID,
      }));
    },

    /**
     * Enable a plugin: remove persisted disabled state, activate, persist.
     * Blocks self-disable of plugin-manager.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async enablePlugin(id) {
      log.info(`enablePlugin: ${id}`);
      const result = await scanner.enable(id);

      if (result.ok && typeof onPluginChanged === 'function') {
        try {
          onPluginChanged();
        } catch (err) {
          log.warn(`onPluginChanged callback error: ${err.message}`);
        }
      }

      return result;
    },

    /**
     * Disable a plugin: deactivate, set state to disabled, persist.
     * Blocks self-disable of plugin-manager.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async disablePlugin(id) {
      log.info(`disablePlugin: ${id}`);
      const result = await scanner.disable(id);

      if (result.ok && typeof onPluginChanged === 'function') {
        try {
          onPluginChanged();
        } catch (err) {
          log.warn(`onPluginChanged callback error: ${err.message}`);
        }
      }

      return result;
    },

    /**
     * Install a plugin from a ZIP archive or folder.
     * Delegates to scanner.install(), then fires onPluginChanged.
     *
     * @param {'zip' | 'folder'} sourceType
     * @param {Buffer | string} source
     * @returns {Promise<{ ok: boolean, error?: string, pluginId?: string }>}
     */
    async installPlugin(sourceType, source) {
      log.info(`installPlugin: type=${sourceType}`);
      const result = await scanner.install(sourceType, source);

      if (result.ok && typeof onPluginChanged === 'function') {
        try {
          onPluginChanged();
        } catch (err) {
          log.warn(`onPluginChanged callback error: ${err.message}`);
        }
      }

      return result;
    },

    /**
     * Uninstall a plugin by ID.
     * Delegates to scanner.uninstall(), then fires onPluginChanged.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async uninstallPlugin(id) {
      log.info(`uninstallPlugin: ${id}`);
      const result = await scanner.uninstall(id);

      if (result.ok && typeof onPluginChanged === 'function') {
        try {
          onPluginChanged();
        } catch (err) {
          log.warn(`onPluginChanged callback error: ${err.message}`);
        }
      }

      return result;
    },

    /**
     * Reinstall a built-in plugin from the pre-compiled release package.
     * Only works for built-in plugins listed in built-in-plugins.json.
     *
     * @param {string} id
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    async reinstallBuiltInPlugin(id) {
      log.info(`reinstallBuiltInPlugin: ${id}`);
      const result = await scanner.reinstallBuiltIn(id);

      if (result.ok && typeof onPluginChanged === 'function') {
        try {
          onPluginChanged();
        } catch (err) {
          log.warn(`onPluginChanged callback error: ${err.message}`);
        }
      }

      return result;
    },
  };
}
