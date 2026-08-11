/**
 * agent-type/app-services.ts — Inter-app service registry type contract
 *
 * Internal (built-in) apps can register service implementations on the
 * backend host, and other apps can resolve them by name.  This is the
 * cross-app communication mechanism — analogous to VS Code's
 * `vscode.commands` but for backend app-to-app calls.
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
 * A registry that allows apps to expose typed services for inter-app
 * consumption.  Each service is identified by a simple string name (no dots
 * needed — apps are the only producers, so collisions are impossible).
 *
 * Services are registered during `activate()` and automatically cleaned up
 * when the app is deactivated.
 */
export interface AppServiceRegistry {
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
   * Returns `undefined` if no app has registered a service under this name.
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
