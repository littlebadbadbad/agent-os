/**
 * MCP App — Core Types
 *
 * Defines the shared contracts between agent, backend, and UI layers.
 * All types are precise — no `any`, no `unknown`, no `as`.
 */

import type {
  ToolDef,
  ToolCallResult,
  ResourceDef,
  ResourceTemplateDef,
  ResourceReadResult,
  PromptDef,
  PromptGetResult,
} from './protocol';

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
  readonly resources: readonly ResourceDef[];
  readonly resourceTemplates: readonly ResourceTemplateDef[];
  readonly prompts: readonly PromptDef[];
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

  /** List all resources exposed by a connected server. */
  listResources(serverName: string): Promise<readonly ResourceDef[]>;

  /** List all resource templates exposed by a connected server. */
  listResourceTemplates(serverName: string): Promise<readonly ResourceTemplateDef[]>;

  /** Read a resource by URI from a connected server. */
  readResource(serverName: string, uri: string): Promise<ResourceReadResult>;

  /** List all prompts exposed by a connected server. */
  listPrompts(serverName: string): Promise<readonly PromptDef[]>;

  /** Get a prompt by name with optional arguments from a connected server. */
  getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<PromptGetResult>;
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

  /** List resources for a server. */
  listResources(serverName: string): Promise<readonly ResourceDef[]>;

  /** List resource templates for a server. */
  listResourceTemplates(serverName: string): Promise<readonly ResourceTemplateDef[]>;

  /** Read a resource by URI. */
  readResource(serverName: string, uri: string): Promise<ResourceReadResult>;

  /** List prompts for a server. */
  listPrompts(serverName: string): Promise<readonly PromptDef[]>;

  /** Get a prompt by name with optional arguments. */
  getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<PromptGetResult>;
}
