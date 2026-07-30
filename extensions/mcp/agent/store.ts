import type { McpServerEntry, McpServerStatus } from './types';

export interface McpStore {
  getAll(): readonly McpServerEntry[];
  get(id: string): McpServerEntry | undefined;
  getByName(name: string): McpServerEntry | undefined;
  setAll(servers: readonly McpServerEntry[]): void;
  remove(id: string): void;
  setStatus(id: string, status: McpServerStatus, errorMsg?: string): void;
}

/**
 * Simple mutable server state container for the MCP ToolSet.
 * Internal to the ToolSet — no reactive subscription layer.
 */
export function createMcpStore(): McpStore {
  let servers: McpServerEntry[] = [];

  return {
    getAll: () => servers,
    get: (id) => servers.find((s) => s.id === id),
    getByName: (name) => servers.find((s) => s.name === name),
    setAll(newServers) { servers = [...newServers]; },
    remove(id) { servers = servers.filter((s) => s.id !== id); },
    setStatus(id, status, errorMsg?) {
      servers = servers.map((s) =>
        s.id === id ? { ...s, status, errorMsg: errorMsg ?? '' } : s,
      );
    },
  };
}
