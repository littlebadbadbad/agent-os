/**
 * MCP ToolSet — Meta-tools + lifecycle management
 *
 * Architecture:
 *   The backend owns all MCP connections (avoids CORS restrictions).
 *   The ToolSet is the single point of authority for both agent tool registration
 *   and the reactive UI store.  All lifecycle operations (connect / disconnect /
 *   reload / remove / addServer) go through the ToolSet so that proxy tools are
 *   always kept in sync with connected MCP servers.
 *
 * The ToolSet captures agent references via `onAttach` when registered on an agent.
 *
 * Slot declarations and agent APIs are returned alongside the ToolSet — see
 * `createMcpToolset`.
 */

import { z } from "zod";
import { defineTool } from "@agent-type/defineTool";
import type { Tool, ToolSet, AgentClientLike, PluginSlotDeclaration, AgentApiHandler, CompactToolCardDescriptor, ToolCallInfo } from "@agent-type";
import type { McpAdapter, McpServerEntry, McpToolDef } from "./types";
import { createMcpStore } from "./store";

// ── Symbol ────────────────────────────────────────────────────────────────────

export const MCP_MANAGER_SYMBOL = Symbol("mcp-manager");

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

const COMPACT_LABEL: Record<string, string> = {
  list_mcp_servers:   "List MCP Servers",
  add_mcp_server:     "Add MCP Server",
  remove_mcp_server:  "Remove MCP Server",
  connect_mcp_server: "Connect MCP Server",
  disable_mcp_server: "Disable MCP Server",
};

function mcpDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const { name, arguments: args, status, result, error } = info;

  const icon = "🔌";
  const label = COMPACT_LABEL[name] ?? name;

  if (status === "error" && error) {
    const short = error.split("\n")[0];
    const summary = short.length > 60 ? `${short.slice(0, 60)}…` : short;
    return { icon, label, summary, status: "error" };
  }

  let summary = label;

  switch (name) {
    case "list_mcp_servers": {
      if (status === "running") { summary = "Listing MCP servers…"; break; }
      const count = arrLen(result);
      summary = `${count} MCP server${count !== 1 ? "s" : ""}`;
      break;
    }
    case "add_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") { summary = `Adding ${serverName ?? "server"}…`; break; }
      summary = `${serverName ?? "Server"} added`;
      break;
    }
    case "remove_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") { summary = `Removing ${serverName ?? "server"}…`; break; }
      summary = `${serverName ?? "Server"} removed`;
      break;
    }
    case "connect_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") { summary = `Connecting ${serverName ?? "server"}…`; break; }
      summary = `${serverName ?? "Server"} connected`;
      break;
    }
    case "disable_mcp_server": {
      const serverName = str(args?.name);
      if (status === "running") { summary = `Disabling ${serverName ?? "server"}…`; break; }
      summary = `${serverName ?? "Server"} disabled`;
      break;
    }
  }

  return { icon, label, summary, status };
}

// ── Proxy tool factory ────────────────────────────────────────────────────────

function createMcpProxyTool(
  serverName: string,
  toolDef: McpToolDef,
  adapter: McpAdapter,
): Tool {
  return {
    name: toolDef.name,
    description: toolDef.description ?? toolDef.name,
    group: serverName,
    parameters: z.record(z.string(), z.unknown()),
    rawParametersSchema: toolDef.inputSchema,
    execute: async (args, ctx) => {
      return adapter.executeTool(
        serverName,
        toolDef.name,
        args,
        ctx.sessionId,
        ctx.signal,
      );
    },
  };
}

// ── Agent registration helpers ────────────────────────────────────────────────

type RegisteredEntry = { toolNames: string[]; unregFns: (() => void)[] };

// ── ToolSet factory ───────────────────────────────────────────────────────────

/**
 * Build the MCP ToolSet and its standalone slot declarations.
 *
 * Register via `host.registerToolSet(toolSet, slotDeclarations)` — the ToolSet
 * captures the agent reference via `onAttach` and keeps proxy tools in sync
 * whenever servers connect or disconnect.
 *
 * Slot declarations are returned as part of the bundle so they can be passed
 * independently of session state.
 *
 * @param adapter  MCP backend adapter (use `createMcpPluginAdapter` for the default backend).
 */
export function createMcpToolset(adapter: McpAdapter): {
  readonly toolSet: ToolSet;
  readonly slotDeclarations: readonly PluginSlotDeclaration[];
  readonly agentApis: Map<string, AgentApiHandler>;
} {
  const store = createMcpStore();

  /**
   * All attached agents (the `createCombinedPluginContext` fans out to both
   * stream and async agents — `onAttach` fires once per agent).  Using a Set
   * ensures proxy tools registered by `syncFromAdapter` land on EVERY agent,
   * not just the last one that called `onAttach`.
   */
  const attachedAgents = new Set<AgentClientLike>();

  /** serverName → registered proxy tools + unregister fns. */
  const serverRegistry = new Map<string, RegisteredEntry>();

  function registerServerTools(
    serverName: string,
    toolDefs: McpToolDef[],
  ): void {
    if (attachedAgents.size === 0) return;
    unregisterServerTools(serverName);
    const proxies = toolDefs.map((t) =>
      createMcpProxyTool(serverName, t, adapter),
    );
    const unregFns: (() => void)[] = [];
    for (const proxy of proxies) {
      for (const agent of attachedAgents) {
        try {
          unregFns.push(agent.registerTool(proxy));
        } catch {
          /* already registered — skip */
        }
      }
    }
    serverRegistry.set(serverName, {
      toolNames: proxies.map((t) => t.name),
      unregFns,
    });
  }

  function unregisterServerTools(serverName: string): void {
    const entry = serverRegistry.get(serverName);
    if (!entry) return;
    for (const fn of entry.unregFns) {
      try { fn(); } catch { /* ignore */ }
    }
    serverRegistry.delete(serverName);
  }

  // ── Sync store + proxies from adapter ──────────────────────────────────────

  async function syncFromAdapter(): Promise<McpServerEntry[]> {
    let servers: McpServerEntry[];
    try {
      servers = await adapter.listServers();
    } catch {
      return store.getAll();
    }
    for (const server of servers) {
      if (server.status === "connected" && server.tools.length > 0) {
        registerServerTools(server.name, server.tools);
      } else {
        unregisterServerTools(server.name);
      }
    }
    store.setAll(servers);
    return servers;
  }

  // ── UI-callable lifecycle operations ───────────────────────────────────────

  async function connect(id: string): Promise<void> {
    const entry = store.get(id);
    if (!entry) throw new Error(`MCP server "${id}" not found.`);
    store.setStatus(id, "connecting");
    try {
      await adapter.reconnectServer(entry.name);
    } finally {
      await syncFromAdapter();
    }
  }

  function disconnect(id: string): void {
    const entry = store.get(id);
    if (!entry) return;
    store.setStatus(id, "disconnected");
    unregisterServerTools(entry.name);
    adapter
      .disconnectServer(entry.name)
      .then(() => syncFromAdapter())
      .catch(() => {});
  }

  function remove(id: string): void {
    const entry = store.get(id);
    if (!entry) return;
    unregisterServerTools(entry.name);
    store.remove(id);
    adapter
      .removeServer(entry.name)
      .then(() => syncFromAdapter())
      .catch(() => {});
  }

  async function addServer(
    config: Pick<McpServerEntry, "name" | "url" | "transport"> & {
      headers?: Record<string, string>;
      includeTools?: string[];
      enabled?: boolean;
      useProxy?: boolean;
    },
  ): Promise<McpServerEntry> {
    const entry = await adapter.addServer({
      ...config,
      enabled: config.enabled ?? true,
    });
    await syncFromAdapter();
    return store.getByName(config.name) ?? entry;
  }

  async function sync(): Promise<McpServerEntry[]> {
    return syncFromAdapter();
  }

  // ── Agent meta-tools ──────────────────────────────────────────────────────

  const listMcpServers = defineTool({
    name: "list_mcp_servers",
    group: "MCP",
    description:
      "List all registered MCP servers with their connection status, transport type, and available tools.",
    parameters: z.object({}),
    execute: async () => {
      await syncFromAdapter();
      return store.getAll().map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        transport: s.transport,
        enabled: s.enabled,
        status: s.status,
        toolCount: s.tools.length,
        tools: s.tools.map((t) => t.name),
        errorMsg: s.errorMsg,
      }));
    },
  });

  const addMcpServer = defineTool({
    name: "add_mcp_server",
    group: "MCP",
    description:
      "Register a new MCP server and connect to it so its tools are immediately available. " +
      'Use transport "http" for MCP 2025-03-26 Streamable HTTP servers (recommended). ' +
      'Use "sse" for legacy 2024-11-05 SSE servers.',
    parameters: z.object({
      name: z
        .string()
        .describe(
          'Unique name for this server, e.g. "github" or "filesystem".',
        ),
      url: z.string().url().describe("Endpoint URL."),
      transport: z
        .enum(["http", "sse"])
        .describe('"http" (recommended) or "sse" (legacy).'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Extra HTTP headers, e.g. { "Authorization": "Bearer <token>" }.',
        ),
      includeTools: z
        .array(z.string())
        .optional()
        .describe("If set, only expose these tool names from the server."),
    }),
    execute: async ({ name, url, transport, headers, includeTools }) => {
      try {
        const entry = await addServer({
          name,
          url,
          transport,
          headers,
          includeTools,
        });
        if (entry.status === "error")
          return { ok: false, error: entry.errorMsg };
        return {
          ok: true,
          message: `MCP server "${name}" connected. ${entry.tools.length} tool(s) available.`,
        };
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err);
        return { ok: false, error: msg };
      }
    },
  });

  const removeMcpServer = defineTool({
    name: "remove_mcp_server",
    group: "MCP",
    description:
      "Disconnect and permanently remove an MCP server. All its tools are removed from the agent.",
    parameters: z.object({
      name: z.string().describe("Name of the MCP server to remove."),
    }),
    execute: async ({ name }) => {
      const entry = store.getByName(name);
      if (!entry)
        return { ok: false, error: `No MCP server named "${name}" found.` };
      remove(entry.id);
      return { ok: true, message: `MCP server "${name}" removed.` };
    },
  });

  const connectMcpServer = defineTool({
    name: "connect_mcp_server",
    group: "MCP",
    description:
      "Connect (or reconnect) to a registered MCP server and activate its tools. " +
      "Also use this to reload the tool list after the server adds or removes tools.",
    parameters: z.object({
      name: z.string().describe("Name of the MCP server."),
    }),
    execute: async ({ name }) => {
      const entry = store.getByName(name);
      if (!entry)
        return {
          ok: false,
          error: `No MCP server named "${name}" found. Use add_mcp_server first.`,
        };
      try {
        await connect(entry.id);
        const updated = store.getByName(name);
        return {
          ok: true,
          message: `MCP server "${name}" connected. ${updated?.tools.length ?? 0} tool(s) available.`,
        };
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err);
        return { ok: false, error: msg };
      }
    },
  });

  const disableMcpServer = defineTool({
    name: "disable_mcp_server",
    group: "MCP",
    description:
      "Disconnect from an MCP server and remove its tools (keeps the server registered for later re-connection).",
    parameters: z.object({
      name: z.string().describe("Name of the MCP server to disable."),
    }),
    execute: async ({ name }) => {
      const entry = store.getByName(name);
      if (!entry)
        return { ok: false, error: `No MCP server named "${name}" found.` };
      disconnect(entry.id);
      return { ok: true, message: `MCP server "${name}" disconnected.` };
    },
  });

  // ── ToolSet ───────────────────────────────────────────────────────────────

  const MCP_TOOL_NAMES: readonly string[] = [
    "list_mcp_servers",
    "add_mcp_server",
    "remove_mcp_server",
    "connect_mcp_server",
    "disable_mcp_server",
  ];

  const slotDeclarations: readonly PluginSlotDeclaration[] = [
    {
      type: "toolButton",
      label: "MCP",
      icon: "\u{1F50C}",
      order: 20,
      showBtn: () => true,
      badge: () => {
        const connected = store
          .getAll()
          .filter((s) => s.status === "connected").length;
        return connected > 0 ? `${connected}` : null;
      },
    },
    {
      type: "toolCard",
      toolNames: MCP_TOOL_NAMES,
    },
    {
      type: "compactToolCard",
      toolNames: MCP_TOOL_NAMES,
      getDescriptor: mcpDescriptor,
    },
  ];

  const toolset: ToolSet = {
    symbol: MCP_MANAGER_SYMBOL,
    name: "mcp-manager",
    coreTools: ["list_mcp_servers"],
    tools: [
      listMcpServers,
      addMcpServer,
      removeMcpServer,
      connectMcpServer,
      disableMcpServer,
    ],

    onAttach(agent: AgentClientLike): () => void {
      attachedAgents.add(agent);
      // Register all currently-connected server proxy tools.
      for (const server of store.getAll()) {
        if (server.status === "connected" && server.tools.length > 0) {
          registerServerTools(server.name, server.tools);
        }
      }
      // Auto-sync from backend on first attach.
      syncFromAdapter().catch(() => {});
      return () => {
        attachedAgents.delete(agent);
        // Only clean up when ALL agents detach — single-agent cleanup would
        // remove tools that the other agent still needs.
        if (attachedAgents.size === 0) {
          for (const entry of serverRegistry.values()) {
            for (const fn of entry.unregFns) {
              try { fn(); } catch { /* ignore */ }
            }
          }
          serverRegistry.clear();
        }
      };
    },
  };

  // ── Agent APIs (callable from plugin UI) ────────────────────────────────

  const agentApis = new Map<string, AgentApiHandler>([
    ['sync', async () => syncFromAdapter()],
    ['connect', async (params) => {
      const name = params?.name;
      if (typeof name === 'string') {
        const entry = store.getByName(name);
        if (entry) await connect(entry.id);
      }
    }],
    ['disconnect', async (params) => {
      const name = params?.name;
      if (typeof name === 'string') {
        const entry = store.getByName(name);
        if (entry) disconnect(entry.id);
      }
    }],
    ['remove', async (params) => {
      const name = params?.name;
      if (typeof name === 'string') {
        const entry = store.getByName(name);
        if (entry) remove(entry.id);
      }
    }],
    ['addServer', async (params) => {
      if (params && typeof params === 'object') {
        return addServer({
          name: String(params.name ?? ''),
          url: String(params.url ?? ''),
          transport: params.transport === 'sse' ? 'sse' : 'http',
          headers: params.headers as Record<string, string> | undefined,
          useProxy: typeof params.useProxy === 'boolean' ? params.useProxy : undefined,
        });
      }
      throw new Error('addServer requires config parameters');
    }],
  ]);

  return { toolSet: toolset, slotDeclarations, agentApis };
}
