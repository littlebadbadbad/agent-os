/**
 * backend/lib/app-services.js — Runtime AppServiceRegistry implementation
 *
 * Provides a createAppServiceRegistry() factory that returns a mutable
 * registry object conforming to the AppServiceRegistry interface from
 * @agent-type.  This is the shared registry that ALL backend app hosts
 * receive — internal apps register services, and other apps resolve
 * them by name.
 *
 * Lifecycle:
 *   - Created once in app-scanner.js during bootstrap.
 *   - Passed to every createAppHost() call.
 *   - When a app is deactivated, its registered services are automatically
 *     cleaned up via the unregister function returned by register().
 *
 * Usage:
 *   import { createAppServiceRegistry } from './app-services.js';
 *   const registry = createAppServiceRegistry();
 *   host.services = registry;
 */

/** @import { AppServiceRegistry } from '../../agent-type/app-services.ts' */

/**
 * Create a new empty AppServiceRegistry.
 *
 * @returns {AppServiceRegistry}
 */
export function createAppServiceRegistry() {
  /** @type {Map<string, unknown>} */
  const _services = new Map();

  return {
    register(serviceName, implementation) {
      if (typeof serviceName !== 'string' || serviceName.length === 0) {
        throw new Error('register: serviceName must be a non-empty string');
      }
      if (implementation === null || implementation === undefined) {
        throw new Error(`register: implementation for "${serviceName}" must not be null/undefined`);
      }
      if (_services.has(serviceName)) {
        throw new Error(
          `register: service "${serviceName}" is already registered. ` +
          `Unregister the existing service before replacing it.`,
        );
      }

      _services.set(serviceName, implementation);

      return () => {
        _services.delete(serviceName);
      };
    },

    resolve(serviceName) {
      return /** @type {T | undefined} */ (_services.get(serviceName));
    },

    list() {
      return Array.from(_services.keys());
    },
  };
}
