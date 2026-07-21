import type { PluginStateExtension } from '@agent-type';

// ── Transport & status ────────────────────────────────────────────────────────

export type McpTransport = 'http' | 'sse';

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ── Tool definition from a connected MCP server ───────────────────────────────

export type McpToolDef = {
  name:         string;
  description?: string;
  inputSchema:  Record<string, unknown>;
};

// ── Server entry ──────────────────────────────────────────────────────────────

export type McpServerEntry = {
  /** Stable id assigned by the backend. */
  readonly id:    string;
  /** Display name — must be unique. */
  name:           string;
  url:            string;
  transport:      McpTransport;
  headers?:       Record<string, string>;
  includeTools?:  string[];
  enabled:        boolean;
  /** Whether to route connections through the globally configured proxy. */
  useProxy?:      boolean;
  status:         McpServerStatus;
  errorMsg?:      string;
  /** Tools exposed by this server (populated when connected). */
  tools:          McpToolDef[];
};

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Plug-in contract for the MCP backend.
 *
 * The default HTTP implementation delegates all MCP connections to the backend
 * (Node.js has no CORS restrictions) and calls `/api/mcp/*`.
 */
export type McpAdapter = {
  /** Return all registered MCP servers with their current status and tools. */
  listServers(): Promise<McpServerEntry[]>;

  /**
   * Add a new server and attempt to connect.
   * Returns the full server entry after the connect attempt.
   */
  addServer(config: Pick<McpServerEntry, 'name' | 'url' | 'transport'> & {
    headers?:      Record<string, string>;
    includeTools?: string[];
    enabled?:      boolean;
    useProxy?:     boolean;
  }): Promise<McpServerEntry>;

  /** Remove a server (disconnect first if needed). */
  removeServer(name: string): Promise<void>;

  /** Reconnect (re-establish the MCP session and refresh the tool list). */
  reconnectServer(name: string): Promise<void>;

  /** Disconnect without removing from the registry. */
  disconnectServer(name: string): Promise<void>;

  /**
   * Execute an MCP tool on the backend proxy.
   *
   * @param server     Name of the MCP server.
   * @param tool       Name of the tool to execute.
   * @param args       Tool arguments.
   * @param sessionId  Optional session ID forwarded from the tool execution context.
   * @param signal     Optional abort signal — cancels the HTTP request if the
   *                   parent tool call is aborted (e.g. user cancels the session).
   */
  executeTool(server: string, tool: string, args: unknown, sessionId?: string, signal?: AbortSignal): Promise<unknown>;
};

// ── Bridge: shared agent↔UI object ───────────────────────────────────────────

/**
 * MCP bridge — agent and UI hold the same reference.
 * Agent writes methods during activation; UI calls them via `host.bridge`.
 */
export interface McpBridge {
  /** Sync server list from backend. */
  sync(): Promise<McpServerEntry[]>;
  /** Connect/reconnect to a server by name. */
  connect(name: string): Promise<void>;
  /** Disconnect a server by name. */
  disconnect(name: string): void;
  /** Remove a server by name. */
  remove(name: string): void;
  /** Add a new server and connect. */
  addServer(config: {
    name: string;
    url: string;
    transport: McpTransport;
    headers?: Record<string, string>;
    includeTools?: string[];
    enabled?: boolean;
    useProxy?: boolean;
  }): Promise<McpServerEntry>;
}
