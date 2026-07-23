/**
 * backend/core/index.js — Super built-in plugin registry
 *
 * Registers all super built-in plugins (system, proxy, models, sessions, etc.)
 * on the shared plugin router.  Each domain module exports a `register(router, deps)`
 * function that calls `defineApi` / `defineStream` to register its endpoints.
 *
 * Core plugins share the same routing infrastructure as regular plugins
 * (pluginRouter), so both HTTP and IPC transports handle them uniformly.
 *
 * Usage:
 *   import { registerCorePlugins } from './core/index.js';
 *   registerCorePlugins(pluginRouter, { pluginScanner, pluginConfigStore });
 */

import { register as registerSystem } from './system.js';
import { register as registerProxy } from './proxy.js';
import { register as registerModels } from './models.js';
import { register as registerModelConfig } from './model-config.js';
import { register as registerSessions } from './sessions.js';
import { register as registerChat } from './chat.js';
import { register as registerApiKeys } from './api-keys.js';
import { register as registerPluginManager } from './plugin-manager.js';

/**
 * Register all super built-in plugins on the given router.
 *
 * @param {import('../lib/plugin-router.js').pluginRouter} router
 * @param {Object} deps - Dependencies required by core plugins (scanner, configStore, etc.)
 * @param {import('../lib/plugin-scanner.js').PluginScanner} deps.pluginScanner
 * @param {import('../lib/plugin-config-store.js').PluginConfigStore} deps.pluginConfigStore
 */
export function registerCorePlugins(router, deps) {
  registerSystem(router);
  registerProxy(router);
  registerModels(router);
  registerModelConfig(router);
  registerSessions(router);
  registerChat(router);
  registerApiKeys(router);
  registerPluginManager(router, deps);
}
