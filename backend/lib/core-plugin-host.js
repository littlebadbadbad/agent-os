/**
 * backend/lib/core-plugin-host.js — Lightweight host for super built-in plugins
 *
 * Core plugins (system, proxy, sessions, plugin-manager, etc.) use this host
 * instead of the full BackendPluginHost, because they don't need plugin data
 * directories, agent directories, or config access — they call backend services
 * directly.
 *
 * The host only provides:
 *   - defineApi(method, handler) — register a named API method on the router
 *   - defineStream(name, handler) — register a streaming endpoint on the router
 *
 * Usage:
 *   import { createCorePluginHost } from '../lib/core-plugin-host.js';
 *
 *   export function register(router) {
 *     const host = createCorePluginHost('system', router);
 *     host.defineApi('publicKey', async () => ({ key: '...' }));
 *   }
 */

/** @import { pluginRouter } from './plugin-router.js' */

/**
 * Create a minimal host for a super built-in plugin.
 *
 * @param {string} pluginId - Plugin identifier (kebab-case).
 * @param {pluginRouter} router - Shared plugin router instance.
 * @returns {Readonly<{ defineApi: Function, defineStream: Function }>}
 */
export function createCorePluginHost(pluginId, router) {
  return {
    defineApi(method, handler) {
      router.registerApi(pluginId, method, handler);
    },

    defineStream(name, handler) {
      router.registerStream(pluginId, name, handler);
    },
  };
}
