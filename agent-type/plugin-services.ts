/**
 * agent-type/plugin-services.ts — Inter-plugin service registry type contract
 *
 * Internal (built-in) plugins can register service implementations on the
 * backend host, and other plugins can resolve them by name.  This is the
 * cross-plugin communication mechanism — analogous to VS Code's
 * `vscode.commands` but for backend plugin-to-plugin calls.
 *
 * Example:
 *   // Terminal backend registers:
 *   host.services.register('terminal', { createTerminalSession, ... });
 *
 *   // MCP backend resolves:
 *   const terminal = host.services.resolve('terminal');
 *   if (terminal) terminal.createTerminalSession({ ... });
 */

/**
 * A registry that allows plugins to expose typed services for inter-plugin
 * consumption.  Each service is identified by a simple string name (no dots
 * needed — plugins are the only producers, so collisions are impossible).
 *
 * Services are registered during `activate()` and automatically cleaned up
 * when the plugin is deactivated.
 */
export interface PluginServiceRegistry {
  /**
   * Register a service implementation under `serviceName`.
   * Returns an unregister function for lifecycle management.
   *
   * @typeParam T  The typed interface of the service.
   * @param serviceName  Unique name for this service (e.g., `'terminal'`, `'browser'`).
   * @param implementation  The service implementation object.
   * @returns  A function that, when called, removes this service from the registry.
   */
  register<T>(serviceName: string, implementation: T): () => void;

  /**
   * Resolve a registered service by name.
   * Returns `undefined` if no plugin has registered a service under this name.
   *
   * @typeParam T  The expected interface of the service.
   * @param serviceName  The name used when the service was registered.
   * @returns  The service implementation, or `undefined`.
   */
  resolve<T>(serviceName: string): T | undefined;

  /**
   * List all currently registered service names.
   * Useful for debugging and introspection.
   */
  list(): readonly string[];
}
