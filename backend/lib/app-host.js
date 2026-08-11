/**
 * backend/lib/app-host.js — Creates sandboxed BackendAppHost instances.
 *
 * Each app activation gets its own host object that is the app's only
 * window into the core system. The host provides:
 *   - defineApi / defineStream: register endpoints via the shared router
 *   - getAppDataDir: scoped writable directory for the app
 *   - getAppPath: security-gated access to system paths
 *
 * Security model:
 *   App code can only interact with the system through the host API.
 *
 * Usage:
 *   import { createAppHost } from './app-host.js';
 *   const host = createAppHost('browser', manifest, router, appsDir);
 */

/** @import { ProxyConfig, AppManifest, BackendAppHost } from '../../agent-type/app.ts' */
/** @import { AppServiceRegistry } from '../../agent-type/app-services.ts' */
/** @import { appRouter } from './app-router.js' */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { createLogger } from './logger.js';

const log = createLogger('app-host');

/**
 * Map of backend service accessors exposed via `host.getBackendConfig(key)`.
 * Extend this to expose more backend capabilities to apps.
 *
 * @typedef {Object} BackendServices
 * @property {() => ProxyConfig} [proxy]  - Current proxy configuration.
 * @property {() => AppManagementService} [appManager]  - App management service (only exposed to app-manager).
 */

/**
 * Create a BackendAppHost for a given app.
 *
 * @param {string} appId   - Unique app identifier (kebab-case, matches manifest.id).
 * @param {AppManifest} manifest - Parsed app manifest.
 * @param {appRouter} router - Shared app router instance.
 * @param {string} appsDir   - Absolute path to the apps directory.
 * @param {string} dataRoot     - Absolute path to the data root directory (for app data dirs).
 * @param {BackendServices} [backendServices]  - Optional map of backend service accessors.
 * @param {string} [agentDir]   - Absolute path to the `.agent/` directory.
 * @param {AppServiceRegistry} [services]   - Shared inter-app service registry.
 * @returns {BackendAppHost}
 */
export function createAppHost(appId, manifest, router, appsDir, dataRoot, backendServices = {}, agentDir = null, services = null) {
  const appDataDir = join(dataRoot, 'app-data', appId);

  // Ensure the app's data directory exists.
  if (!existsSync(appDataDir)) {
    mkdirSync(appDataDir, { recursive: true });
  }

  /** Lazily-created logger — namespace = appId. */
  let _logger = null;

  const host = {
    /** Structured logger scoped to this app (created on first access). */
    get logger() {
      if (!_logger) _logger = createLogger(appId);
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
      router.registerApi(appId, method, handler);
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
      router.registerStream(appId, name, handler);
    },

    getAppDataDir() {
      return appDataDir;
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

    /**
     * Shared inter-app service registry.
     * Apps register services during activation; other apps resolve
     * them by name.  The same registry is shared across all app hosts.
     */
    services,
  };

  return host;
}
