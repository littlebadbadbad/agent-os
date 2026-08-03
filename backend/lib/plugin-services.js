/**
 * backend/lib/plugin-services.js — Runtime PluginServiceRegistry implementation
 *
 * Provides a createPluginServiceRegistry() factory that returns a mutable
 * registry object conforming to the PluginServiceRegistry interface from
 * @agent-type.  This is the shared registry that ALL backend plugin hosts
 * receive — internal plugins register services, and other plugins resolve
 * them by name.
 *
 * Lifecycle:
 *   - Created once in plugin-scanner.js during bootstrap.
 *   - Passed to every createPluginHost() call.
 *   - When a plugin is deactivated, its registered services are automatically
 *     cleaned up via the unregister function returned by register().
 *
 * Usage:
 *   import { createPluginServiceRegistry } from './plugin-services.js';
 *   const registry = createPluginServiceRegistry();
 *   host.services = registry;
 */

/** @import { PluginServiceRegistry } from '../../agent-type/plugin-services.ts' */

/**
 * Create a new empty PluginServiceRegistry.
 *
 * @returns {PluginServiceRegistry}
 */
export function createPluginServiceRegistry() {
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
