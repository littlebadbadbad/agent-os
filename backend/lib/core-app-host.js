/**
 * backend/lib/core-app-host.js — Lightweight host for super built-in apps
 *
 * Core apps (system, proxy, sessions, app-manager, etc.) use this host
 * instead of the full BackendAppHost, because they don't need app data
 * directories, agent directories, or config access — they call backend services
 * directly.
 *
 * The host only provides:
 *   - defineApi(method, handler) — register a named API method on the router
 *   - defineStream(name, handler) — register a streaming endpoint on the router
 *
 * Usage:
 *   import { createCoreAppHost } from '../lib/core-app-host.js';
 *
 *   export function register(router) {
 *     const host = createCoreAppHost('system', router);
 *     host.defineApi('publicKey', async () => ({ key: '...' }));
 *   }
 */

/** @import { appRouter } from './app-router.js' */

/**
 * Create a minimal host for a super built-in app.
 *
 * @param {string} appId - App identifier (kebab-case).
 * @param {appRouter} router - Shared app router instance.
 * @returns {Readonly<{ defineApi: Function, defineStream: Function }>}
 */
export function createCoreAppHost(appId, router) {
  return {
    defineApi(method, handler) {
      router.registerApi(appId, method, handler);
    },

    defineStream(name, handler) {
      router.registerStream(appId, name, handler);
    },
  };
}
