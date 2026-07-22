/**
 * extensions/plugin-manager/backend/index.js — Plugin Manager backend entry
 *
 * Registers API methods for plugin management via BackendPluginHost.
 * Uses the `pluginManager` capability (only available to this plugin).
 *
 * API methods:
 *   list   — returns all plugins with state, builtIn, canDisable
 *   enable — enables a plugin by ID
 *   disable — disables a plugin by ID
 *
 * Factory function, no classes.
 */

/** @import { BackendPluginHost } from '@agent-type' */

export function activate(host) {
  const log = host.logger;
  log.info('plugin-manager backend activated');

  // Get the plugin management service (only available to this plugin).
  const getService = () => {
    const svc = host.getBackendConfig('pluginManager');
    if (!svc) {
      throw new Error('Plugin management service is not available');
    }
    return svc;
  };

  // ── API: list ──────────────────────────────────────────────────────────

  host.defineApi('list', async () => {
    const svc = getService();
    const plugins = svc.listPlugins();
    return { plugins };
  });

  // ── API: enable ────────────────────────────────────────────────────────

  host.defineApi('enable', async (params) => {
    const { id } = params || {};
    if (!id || typeof id !== 'string') {
      throw new Error('id is required');
    }
    const svc = getService();
    const result = await svc.enablePlugin(id);
    if (!result.ok) {
      throw new Error(result.error || `Failed to enable plugin "${id}"`);
    }
    return { ok: true };
  });

  // ── API: disable ───────────────────────────────────────────────────────

  host.defineApi('disable', async (params) => {
    const { id } = params || {};
    if (!id || typeof id !== 'string') {
      throw new Error('id is required');
    }
    const svc = getService();
    const result = await svc.disablePlugin(id);
    if (!result.ok) {
      throw new Error(result.error || `Failed to disable plugin "${id}"`);
    }
    return { ok: true };
  });
}
