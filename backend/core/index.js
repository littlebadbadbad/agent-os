/**
 * backend/core/index.js — Super built-in app registry
 *
 * Registers all super built-in apps (system, proxy, models, sessions, etc.)
 * on the shared app router.  Each domain module exports a `register(router, deps)`
 * function that calls `defineApi` / `defineStream` to register its endpoints.
 *
 * Core apps share the same routing infrastructure as regular apps
 * (appRouter), so both HTTP and IPC transports handle them uniformly.
 *
 * Usage:
 *   import { registerCoreApps } from './core/index.js';
 *   registerCoreApps(appRouter, { appScanner, appConfigStore });
 */

import { register as registerSystem } from './system.js';
import { register as registerProxy } from './proxy.js';
import { register as registerModels } from './models.js';
import { register as registerModelConfig } from './model-config.js';
import { register as registerSessions } from './sessions.js';
import { register as registerChat } from './chat.js';
import { register as registerApiKeys } from './api-keys.js';
import { register as registerAppManager } from './app-manager.js';

/**
 * Register all super built-in apps on the given router.
 *
 * @param {import('../lib/app-router.js').appRouter} router
 * @param {Object} deps - Dependencies required by core apps (scanner, configStore, etc.)
 * @param {import('../lib/app-scanner.js').AppScanner} deps.appScanner
 * @param {import('../lib/app-config-store.js').AppConfigStore} deps.appConfigStore
 */
export function registerCoreApps(router, deps) {
  registerSystem(router);
  registerProxy(router);
  registerModels(router);
  registerModelConfig(router);
  registerSessions(router);
  registerChat(router);
  registerApiKeys(router);
  registerAppManager(router, deps);
}
