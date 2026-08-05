/**
 * MCP Plugin — Core Types
 *
 * Defines the shared contracts between agent, backend, and UI layers.
 * All types are precise — no `any`, no `unknown`, no `as`.
 */

import type { ToolDef, ToolCallResult } from './protocol';

// ═══════════════════════════════════════════════════════════════════════════════
//  Transport
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * MCP transport protocol.
 *
 * - `streamable-http`:  MCP Streamable HTTP (single endpoint, POST+GET). Negotiates the
 *   protocol version per-connection; requests 2025-06-18 and adapts down to 2025-03-26.
 * - `legacy-sse`:       MCP 2024-11-05 HTTP+SSE (deprecated, separate SSE+POST endpoints).
 * - `stdio`:            MCP stdio transport (subprocess stdin/stdout).
 */
export type McpTransport = 'streamable-http' | 'legacy-sse' | 'stdio';

// ═══════════════════════════════════════════════════════════════════════════════
//  Server Status
// ═══════════════════════════════════════════════════════════════════════════════

export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ═══════════════════════════════════════════════════════════════════════════════
//  Server Entry (agent-side view)
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpServerEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly transport: McpTransport;
  readonly headers: Record<string, string>;
  readonly includeTools: readonly string[];
  readonly enabled: boolean;
  readonly useProxy: boolean;
  readonly status: McpServerStatus;
  readonly errorMsg: string;
  readonly tools: readonly ToolDef[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Server Config (used to create/update a server)
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpServerConfig {
  readonly name: string;
  readonly url: string;
  readonly transport: McpTransport;
  readonly headers?: Record<string, string>;
  readonly includeTools?: readonly string[];
  readonly enabled?: boolean;
  readonly useProxy?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Adapter — agent ↔ backend contract
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpAdapter {
  /** List all registered MCP servers with current status and tools. */
  listServers(): Promise<readonly McpServerEntry[]>;

  /** Register a new server and attempt to connect. */
  addServer(config: McpServerConfig): Promise<McpServerEntry>;

  /** Permanently remove a server (disconnect first). */
  removeServer(name: string): Promise<void>;

  /** Reconnect to a server (re-establish session + refresh tools). */
  reconnectServer(name: string): Promise<void>;

  /** Disconnect without removing from registry. */
  disconnectServer(name: string): Promise<void>;

  /**
   * Execute an MCP tool on the backend proxy.
   *
   * Returns the structured MCP `ToolCallResult` — preserving all content
   * types (text, image, resource, etc.).
   */
  executeTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<ToolCallResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Bridge — shared agent↔UI reference
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpBridge {
  /** Sync server list from backend. */
  sync(): Promise<readonly McpServerEntry[]>;

  /** Connect/reconnect to a server by name. */
  connect(name: string): Promise<void>;

  /** Disconnect a server by name. */
  disconnect(name: string): void;

  /** Remove a server by name. */
  remove(name: string): void;

  /** Add a new server and connect. */
  addServer(config: McpServerConfig): Promise<McpServerEntry>;
}
