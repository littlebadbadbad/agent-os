/**
 * extensions/devops/ui/bridge.ts — UiBridge implementation
 *
 * The UI layer creates a UiBridge and assigns its methods to the shared
 * host.bridge object. Agent tools call through host.bridge to interact
 * with React component state without direct coupling.
 *
 * React components register handlers (state getters / action dispatchers)
 * on mount and unregister on unmount. Agent tools call these handlers
 * through the bridge.
 */

import type { DevOpsBridge } from '../agent/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => any;

class UiBridge {
  private handlers = new Map<string, AnyHandler>();

  register(key: string, handler: AnyHandler): void {
    this.handlers.set(key, handler);
  }

  unregister(key: string): void {
    this.handlers.delete(key);
  }

  async call<T = unknown>(key: string, ...args: unknown[]): Promise<T> {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new Error(
        `[devops-bridge] No handler for "${key}". ` +
          `Make sure the relevant component is mounted.`,
      );
    }
    return handler(...args) as T;
  }

  snapshot<T = unknown>(key: string): T {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new Error(
        `[devops-bridge] No snapshot getter for "${key}". ` +
          `Make sure the relevant component is mounted.`,
      );
    }
    return handler() as T;
  }

  isRegistered(key: string): boolean {
    return this.handlers.has(key);
  }

  async waitUntil(
    predicate: () => boolean,
    timeoutMs = 20_000,
    intervalMs = 200,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise<void>((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`[devops-bridge] waitUntil timed out after ${timeoutMs}ms`);
  }
}

/**
 * Create a DevOpsBridge implementation and populate the shared bridge object.
 *
 * @param bridge  The host.bridge object (shared reference between agent and UI).
 */
export function populateDevopsBridge(bridge: DevOpsBridge): UiBridge {
  const impl = new UiBridge();
  bridge.callHandler = impl.call.bind(impl);
  bridge.snapshot = impl.snapshot.bind(impl);
  bridge.isRegistered = impl.isRegistered.bind(impl);
  bridge.waitUntil = impl.waitUntil.bind(impl);
  bridge.registerHandler = impl.register.bind(impl);
  bridge.unregisterHandler = impl.unregister.bind(impl);
  return impl;
}
