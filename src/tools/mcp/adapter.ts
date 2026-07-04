import type { McpAdapter, McpServerEntry, HttpMcpAdapterConfig } from './types';

// ── HTTP fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// ── HTTP MCP adapter factory ──────────────────────────────────────────────────

/**
 * Create an `McpAdapter` that delegates all MCP management to the Agent SDK
 * backend REST API.
 *
 * Routes used:
 *   GET    /mcp/servers                     — list servers + tools
 *   POST   /mcp/servers                     — add & connect
 *   DELETE /mcp/servers/:name               — remove
 *   POST   /mcp/servers/:name/reconnect     — reconnect
 *   POST   /mcp/servers/:name/disconnect    — disconnect
 *   POST   /mcp/execute                     — proxy tool execution
 *
 * @example
 * ```ts
 * const adapter = createHttpMcpAdapter({ baseUrl: '/api' });
 * const mcpManager = createMcpManager(agents, adapter);
 * ```
 */
export function createHttpMcpAdapter(
  config: HttpMcpAdapterConfig = {},
): McpAdapter {
  const base = (config.baseUrl ?? '/api').replace(/\/$/, '');

  return {
    async listServers() {
      const data = await apiFetch<{ servers: McpServerEntry[] }>(`${base}/mcp/servers`);
      return data.servers ?? [];
    },

    async addServer(config) {
      const data = await apiFetch<{ server: McpServerEntry }>(`${base}/mcp/servers`, {
        method: 'POST',
        body: JSON.stringify({
          name:         config.name,
          url:          config.url,
          transport:    config.transport,
          headers:      config.headers,
          includeTools: config.includeTools,
        }),
      });
      return data.server;
    },

    async removeServer(name) {
      await apiFetch(`${base}/mcp/servers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
    },

    async reconnectServer(name) {
      await apiFetch(`${base}/mcp/servers/${encodeURIComponent(name)}/reconnect`, {
        method: 'POST',
      });
    },

    async disconnectServer(name) {
      await apiFetch(`${base}/mcp/servers/${encodeURIComponent(name)}/disconnect`, {
        method: 'POST',
      });
    },

    async executeTool(server, tool, args, sessionId?, signal?) {
      const data = await apiFetch<{ result: unknown }>(`${base}/mcp/execute`, {
        method: 'POST',
        signal,
        body: JSON.stringify({
          server,
          tool,
          arguments: args,
          ...(sessionId !== undefined && { sessionId }),
        }),
      });
      return data.result;
    },
  };
}
