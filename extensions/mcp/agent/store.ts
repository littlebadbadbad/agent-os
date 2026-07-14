import type { McpServerEntry, McpStore, McpServerStatus } from './types';

// ── Internal factory ──────────────────────────────────────────────────────────

/**
 * Create an isolated reactive in-memory MCP server store.
 * Returns a store object scoped to one `createMcpManager` call.
 */
export function createMcpStore(): McpStore & {
  setAll(servers: McpServerEntry[]): void;
  remove(id: string): void;
  setStatus(id: string, status: McpServerStatus, errorMsg?: string): void;
} {
  let servers: McpServerEntry[] = [];
  const listeners = new Set<() => void>();

  function notify() {
    for (const fn of listeners) fn();
  }

  function mutate(updater: (prev: McpServerEntry[]) => McpServerEntry[]) {
    servers = updater(servers);
    notify();
  }

  return {
    getAll: () => servers,
    get: (id) => servers.find((s) => s.id === id),
    getByName: (name) => servers.find((s) => s.name === name),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setAll(newServers) {
      mutate(() => newServers);
    },
    remove(id) {
      mutate((prev) => prev.filter((s) => s.id !== id));
    },
    setStatus(id, status, errorMsg?) {
      mutate((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status, errorMsg: errorMsg ?? undefined } : s,
        ),
      );
    },
  };
}
