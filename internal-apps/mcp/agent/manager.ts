/**
 * MCP ToolSet — Meta-tools + lifecycle management
 *
 * Architecture:
 *   The backend owns all MCP connections (avoids CORS restrictions).
 *   The ToolSet is the single point of authority for both agent tool
 *   registration and the reactive UI store. All lifecycle operations
 *   (connect / disconnect / reload / remove / addServer) go through
 *   the ToolSet so that proxy tools are kept in sync with connected
 *   MCP servers.
 *
 * Slot declarations and bridge methods are returned alongside the
 * ToolSet — see `createMcpToolset`.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type {
  Tool,
  ToolSet,
  AgentClientLike,
  AppSlotDeclaration,
  CompactToolCardDescriptor,
  ToolCallInfo,
  ToolSetContext,
  SystemPromptContext,
} from '@agent-type';
import type {
  ToolDef,
  ContentBlock,
  ResourceDef,
  ResourceTemplateDef,
  ResourceReadResult,
  PromptDef,
  PromptGetResult,
  PromptMessage,
} from './protocol';
import type { McpAdapter, McpServerEntry, McpServerConfig, McpBridge, McpTransport } from './types';
import { createMcpStore } from './store';
import { MCP_SYSTEM_PROMPT } from './prompt';
import type { AutocompleteItem, SlotDisplayContext } from '@agent-type';
import { startsWithPrefix } from '@agent-type';

// ═══════════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const MCP_MANAGER_SYMBOL = Symbol('mcp-manager');

const MCP_TOOL_NAMES: readonly string[] = [
  'list_mcp_servers',
  'add_mcp_server',
  'remove_mcp_server',
  'connect_mcp_server',
  'disable_mcp_server',
  'list_mcp_resources',
  'read_mcp_resource',
  'list_mcp_prompts',
  'get_mcp_prompt',
];

const MCP_TRANSPORT_VALUES = ['streamable-http', 'legacy-sse', 'stdio'] as const satisfies readonly McpTransport[];

const COMPACT_LABEL: Record<string, string> = {
  list_mcp_servers: 'List MCP Servers',
  add_mcp_server: 'Add MCP Server',
  remove_mcp_server: 'Remove MCP Server',
  connect_mcp_server: 'Connect MCP Server',
  disable_mcp_server: 'Disable MCP Server',
  list_mcp_resources: 'List MCP Resources',
  read_mcp_resource: 'Read MCP Resource',
  list_mcp_prompts: 'List MCP Prompts',
  get_mcp_prompt: 'Get MCP Prompt',
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Slash-Mention Parser (mirrors skill app pattern)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract `/word` slash-mention tokens from a user message.
 * Used to detect when the user references an MCP prompt by name.
 */
function parseSlashMentions(text: string): readonly string[] {
  return [...text.matchAll(/\/([\w-]+)/g)].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Error Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Compact Tool-Card Descriptor
// ═══════════════════════════════════════════════════════════════════════════════

function getStringField(value: Record<string, unknown>, key: string): string {
  const v = value[key];
  return typeof v === 'string' ? v : '';
}

function getArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function mcpDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const { name, arguments: args, status, result, error } = info;
  const icon = '\u{1F50C}';
  const label = COMPACT_LABEL[name] ?? name;

  if (status === 'error' && error) {
    const short = error.split('\n')[0];
    const summary = short.length > 60 ? `${short.slice(0, 60)}\u2026` : short;
    return { icon, label, summary, status: 'error' };
  }

  let summary = label;
  const record = args ?? {};

  switch (name) {
    case 'list_mcp_servers': {
      if (status === 'running') { summary = 'Listing MCP servers\u2026'; break; }
      summary = `${getArrayLength(result)} MCP server${getArrayLength(result) !== 1 ? 's' : ''}`;
      break;
    }
    case 'add_mcp_server': {
      const sn = getStringField(record, 'name');
      if (status === 'running') { summary = `Adding ${sn || 'server'}\u2026`; break; }
      summary = `${sn || 'Server'} added`;
      break;
    }
    case 'remove_mcp_server': {
      const sn = getStringField(record, 'name');
      if (status === 'running') { summary = `Removing ${sn || 'server'}\u2026`; break; }
      summary = `${sn || 'Server'} removed`;
      break;
    }
    case 'connect_mcp_server': {
      const sn = getStringField(record, 'name');
      if (status === 'running') { summary = `Connecting ${sn || 'server'}\u2026`; break; }
      summary = `${sn || 'Server'} connected`;
      break;
    }
    case 'disable_mcp_server': {
      const sn = getStringField(record, 'name');
      if (status === 'running') { summary = `Disabling ${sn || 'server'}\u2026`; break; }
      summary = `${sn || 'Server'} disabled`;
      break;
    }
    case 'list_mcp_resources': {
      const sn = getStringField(record, 'server');
      if (status === 'running') { summary = `Listing resources from ${sn}\u2026`; break; }
      summary = `${getArrayLength(result)} resource(s) from ${sn}`;
      break;
    }
    case 'read_mcp_resource': {
      const uri = getStringField(record, 'uri');
      if (status === 'running') { summary = `Reading ${uri || 'resource'}\u2026`; break; }
      summary = `Read ${uri || 'resource'}`;
      break;
    }
    case 'list_mcp_prompts': {
      const sn = getStringField(record, 'server');
      if (status === 'running') { summary = `Listing prompts from ${sn}\u2026`; break; }
      summary = `${getArrayLength(result)} prompt(s) from ${sn}`;
      break;
    }
    case 'get_mcp_prompt': {
      const pn = getStringField(record, 'name');
      if (status === 'running') { summary = `Getting prompt ${pn || '\u2026'}\u2026`; break; }
      summary = `Prompt: ${pn}`;
      break;
    }
  }

  return { icon, label, summary, status };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Content Serialization
// ═══════════════════════════════════════════════════════════════════════════════

function serializeContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return `[Image: ${block.mimeType}]`;
    case 'audio':
      return `[Audio: ${block.mimeType}]`;
    case 'resource': {
      const r = block.resource;
      if (r.text) return r.text;
      return `[Resource: ${r.uri}]`;
    }
    case 'resource_link':
      return `[Resource: ${block.name ?? block.uri}]`;
  }
}

function serializeContent(blocks: readonly ContentBlock[]): string {
  return blocks.map(serializeContentBlock).join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Proxy Tool Factory
// ═══════════════════════════════════════════════════════════════════════════════

function createMcpProxyTool(
  serverName: string,
  toolDef: ToolDef,
  adapter: McpAdapter,
): Tool {
  return {
    name: toolDef.name,
    description: toolDef.description ?? toolDef.name,
    group: serverName,
    parameters: z.record(z.string(), z.unknown()),
    rawParametersSchema: toolDef.inputSchema,
    execute: async (args, ctx) => {
      const result = await adapter.executeTool(
        serverName,
        toolDef.name,
        args as Record<string, unknown>,
        ctx.sessionId,
        ctx.signal,
      );
      const text = serializeContent(result.content);
      if (result.isError) {
        throw new Error(text);
      }
      return text;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Registered Server Tracker
// ═══════════════════════════════════════════════════════════════════════════════

interface RegisteredEntry {
  readonly toolNames: readonly string[];
  readonly unregFns: readonly (() => void)[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ToolSet Factory
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpToolsetBundle {
  readonly toolSet: ToolSet;
  readonly slotDeclarations: readonly SlotDeclaration[];
  readonly bridgeMethods: McpBridge;
}

/**
 * Build the MCP ToolSet, its standalone slot declarations, and UI bridge methods.
 */
export function createMcpToolset(adapter: McpAdapter): McpToolsetBundle {
  const store = createMcpStore();
  const attachedAgents = new Set<AgentClientLike>();
  const serverRegistry = new Map<string, RegisteredEntry>();

  // ── Tool Registration ──────────────────────────────────────────────────

  function registerServerTools(serverName: string, toolDefs: readonly ToolDef[]): void {
    if (attachedAgents.size === 0) return;
    unregisterServerTools(serverName);
    const proxies = toolDefs.map((t) => createMcpProxyTool(serverName, t, adapter));
    const unregFns: (() => void)[] = [];
    for (const proxy of proxies) {
      for (const agent of attachedAgents) {
        unregFns.push(agent.registerTool(proxy));
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
      fn();
    }
    serverRegistry.delete(serverName);
  }

  // ── Sync ───────────────────────────────────────────────────────────────

  async function syncFromAdapter(): Promise<readonly McpServerEntry[]> {
    const servers = await adapter.listServers();
    for (const server of servers) {
      if (server.status === 'connected' && server.tools.length > 0) {
        registerServerTools(server.name, server.tools);
      } else {
        unregisterServerTools(server.name);
      }
    }
    store.setAll(servers);
    return servers;
  }

  // ── Lifecycle Operations ───────────────────────────────────────────────

  async function connect(id: string): Promise<void> {
    const entry = store.get(id);
    if (!entry) {
      throw new Error(`MCP server "${id}" not found.`);
    }
    store.setStatus(id, 'connecting');
    await adapter.reconnectServer(entry.name);
    await syncFromAdapter();
  }

  function disconnect(id: string): void {
    const entry = store.get(id);
    if (!entry) return;
    store.setStatus(id, 'disconnected');
    unregisterServerTools(entry.name);
    adapter.disconnectServer(entry.name).then(() => syncFromAdapter()).catch(() => {});
  }

  function remove(id: string): void {
    const entry = store.get(id);
    if (!entry) return;
    unregisterServerTools(entry.name);
    store.remove(id);
    adapter.removeServer(entry.name).then(() => syncFromAdapter()).catch(() => {});
  }

  async function addServer(config: McpServerConfig): Promise<McpServerEntry> {
    const entry = await adapter.addServer({
      ...config,
      enabled: config.enabled ?? true,
    });
    await syncFromAdapter();
    return store.getByName(config.name) ?? entry;
  }

  // ── Meta-Tools ─────────────────────────────────────────────────────────

  const listMcpServers = defineTool({
    name: 'list_mcp_servers',
    group: 'MCP',
    description: 'List all registered MCP servers — status, transport, tools, errors. Refreshes from backend.',
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
    name: 'add_mcp_server',
    group: 'MCP',
    description: 'Register + connect a MCP server. Three transports: streamable-http (recommended), legacy-sse, stdio.',
    parameters: z.object({
      name: z.string().describe('Unique name for this server, e.g. "github" or "filesystem".'),
      url: z.string().describe('Endpoint URL (for streamable-http/legacy-sse) or command (for stdio).'),
      transport: z.enum(MCP_TRANSPORT_VALUES).describe(
        '"streamable-http" (recommended), "legacy-sse", or "stdio".',
      ),
      headers: z.record(z.string(), z.string()).optional().describe(
        'Extra HTTP headers, e.g. {"Authorization":"Bearer <token>"}. (HTTP transports only)',
      ),
      includeTools: z.array(z.string()).optional().describe(
        'If set, only expose these tool names from the server.',
      ),
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
        if (entry.status === 'error') {
          return { ok: false, error: entry.errorMsg };
        }
        return {
          ok: true,
          message: `MCP server "${name}" connected. ${entry.tools.length} tool(s) available.`,
        };
      } catch (err) {
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
  });

  const removeMcpServer = defineTool({
    name: 'remove_mcp_server',
    group: 'MCP',
    description: 'Permanently remove a server — disconnects and deletes config. All proxy tools are unregistered.',
    parameters: z.object({
      name: z.string().describe('Name of the MCP server to remove.'),
    }),
    execute: async ({ name }) => {
      const entry = store.getByName(name);
      if (!entry) {
        return { ok: false, error: `No MCP server named "${name}" found.` };
      }
      remove(entry.id);
      return { ok: true, message: `MCP server "${name}" removed.` };
    },
  });

  const connectMcpServer = defineTool({
    name: 'connect_mcp_server',
    group: 'MCP',
    description: 'Connect/reconnect to a server. Also refreshes tool list after server-side changes.',
    parameters: z.object({
      name: z.string().describe('Name of the MCP server.'),
    }),
    execute: async ({ name }) => {
      const entry = store.getByName(name);
      if (!entry) {
        return {
          ok: false,
          error: `No MCP server named "${name}" found. Use add_mcp_server first.`,
        };
      }
      try {
        await connect(entry.id);
        const updated = store.getByName(name);
        return {
          ok: true,
          message: `MCP server "${name}" connected. ${updated?.tools.length ?? 0} tool(s) available.`,
        };
      } catch (err) {
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
  });

  const disableMcpServer = defineTool({
    name: 'disable_mcp_server',
    group: 'MCP',
    description: 'Disconnect but keep config. Tools are removed until re-connected with connect_mcp_server.',
    parameters: z.object({
      name: z.string().describe('Name of the MCP server to disable.'),
    }),
    execute: async ({ name }) => {
      const entry = store.getByName(name);
      if (!entry) {
        return { ok: false, error: `No MCP server named "${name}" found.` };
      }
      disconnect(entry.id);
      return { ok: true, message: `MCP server "${name}" disconnected.` };
    },
  });

  // ── Resource Meta-Tools ────────────────────────────────────────────────

  const listMcpResources = defineTool({
    name: 'list_mcp_resources',
    group: 'MCP',
    description: 'List resources exposed by a connected MCP server. Resources are addressable data (files, configs, DB rows) identified by URI.',
    parameters: z.object({
      server: z.string().describe('Name of the MCP server.'),
    }),
    execute: async ({ server }) => {
      try {
        const resources = await adapter.listResources(server);
        const templates = await adapter.listResourceTemplates(server);
        return {
          ok: true,
          resources: resources.map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description ?? '',
            mimeType: r.mimeType ?? '',
          })),
          resourceTemplates: templates.map((t) => ({
            uriTemplate: t.uriTemplate,
            name: t.name,
            description: t.description ?? '',
            mimeType: t.mimeType ?? '',
          })),
        };
      } catch (err) {
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
  });

  const readMcpResource = defineTool({
    name: 'read_mcp_resource',
    group: 'MCP',
    description: 'Read the contents of an MCP resource by URI. Returns text or base64-encoded blob data.',
    parameters: z.object({
      server: z.string().describe('Name of the MCP server.'),
      uri: z.string().describe('URI of the resource to read.'),
    }),
    execute: async ({ server, uri }) => {
      try {
        const result = await adapter.readResource(server, uri);
        const contents = result.contents.map((c) => {
          if (c.text !== undefined) {
            return { uri: c.uri, mimeType: c.mimeType ?? '', text: c.text };
          }
          return { uri: c.uri, mimeType: c.mimeType ?? '', blob: c.blob ?? '' };
        });
        return { ok: true, contents };
      } catch (err) {
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
  });

  // ── Prompt Meta-Tools ──────────────────────────────────────────────────

  const listMcpPrompts = defineTool({
    name: 'list_mcp_prompts',
    group: 'MCP',
    description: 'List prompts exposed by a connected MCP server. Prompts are reusable message templates with optional arguments.',
    parameters: z.object({
      server: z.string().describe('Name of the MCP server.'),
    }),
    execute: async ({ server }) => {
      try {
        const prompts = await adapter.listPrompts(server);
        return {
          ok: true,
          prompts: prompts.map((p) => ({
            name: p.name,
            description: p.description ?? '',
            arguments: (p.arguments ?? []).map((a) => ({
              name: a.name,
              description: a.description ?? '',
              required: a.required ?? false,
            })),
          })),
        };
      } catch (err) {
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
  });

  const getMcpPrompt = defineTool({
    name: 'get_mcp_prompt',
    group: 'MCP',
    description: 'Get a prompt by name from an MCP server. Returns the resolved messages (role + content) ready for the conversation.',
    parameters: z.object({
      server: z.string().describe('Name of the MCP server.'),
      name: z.string().describe('Prompt name (from list_mcp_prompts).'),
      arguments: z.record(z.string(), z.string()).optional().describe(
        'Arguments to fill into the prompt template, if the prompt defines any.',
      ),
    }),
    execute: async ({ server, name, arguments: args }) => {
      try {
        const result = await adapter.getPrompt(server, name, args);
        const messages = result.messages.map((m) => ({
          role: m.role,
          content: serializeContentBlock(m.content),
        }));
        return {
          ok: true,
          description: result.description ?? '',
          messages,
        };
      } catch (err) {
        return { ok: false, error: extractErrorMessage(err) };
      }
    },
  });

  // ── Autocomplete: MCP Prompts ──────────────────────────────────────────

  /**
   * Build autocomplete items for all prompts across all connected servers.
   * Each item inserts `/mcp:<server>:<prompt>` — the same prefix pattern
   * the prompt-injection logic in onGetSystemPrompt looks for.
   */
  function buildPromptAutocompleteItems(
    _ctx: SlotDisplayContext,
  ): readonly AutocompleteItem[] {
    const items: AutocompleteItem[] = [];
    for (const server of store.getAll()) {
      if (server.status !== 'connected') continue;
      for (const prompt of server.prompts) {
        const mention = `mcp:${server.name}:${prompt.name}`;
        items.push({
          id: mention,
          label: `/${mention}`,
          description: prompt.description ?? `MCP prompt from ${server.name}`,
          insertText: `/${mention} `,
        });
      }
    }
    return items;
  }

  // ── Slot Declarations ──────────────────────────────────────────────────

  const slotDeclarations: readonly SlotDeclaration[] = [
    {
      type: 'toolButton',
      label: 'MCP',
      icon: '\u{1F50C}',
      containingWidth: '420px',
      containingHeight: '580px',
      showBtn: () => true,
      badge: () => {
        const connected = store.getAll().filter((s) => s.status === 'connected').length;
        return connected > 0 ? `${connected}` : null;
      },
    },
    {
      type: 'autocomplete',
      shouldTrigger: startsWithPrefix('/'),
      getItems: (ctx: SlotDisplayContext) => buildPromptAutocompleteItems(ctx),
    },
    {
      type: 'toolCard',
      toolNames: MCP_TOOL_NAMES,
    },
    {
      type: 'compactToolCard',
      toolNames: MCP_TOOL_NAMES,
      getDescriptor: mcpDescriptor,
    },
  ];

  // ── ToolSet ────────────────────────────────────────────────────────────

  const toolset: ToolSet = {
    symbol: MCP_MANAGER_SYMBOL,
    name: 'mcp-manager',
    coreTools: ['list_mcp_servers'],
    tools: [
      listMcpServers,
      addMcpServer,
      removeMcpServer,
      connectMcpServer,
      disableMcpServer,
      listMcpResources,
      readMcpResource,
      listMcpPrompts,
      getMcpPrompt,
    ],

    onAttach(agent: AgentClientLike): () => void {
      attachedAgents.add(agent);
      for (const server of store.getAll()) {
        if (server.status === 'connected' && server.tools.length > 0) {
          registerServerTools(server.name, server.tools);
        }
      }
      // Trigger async background sync — do not block onAttach return.
      // Tests that depend on the store being populated after onAttach
      // should await bridgeMethods.sync() first.
      const syncPromise = syncFromAdapter();
      syncPromise.catch(() => {});
      return () => {
        attachedAgents.delete(agent);
        if (attachedAgents.size === 0) {
          for (const entry of serverRegistry.values()) {
            for (const fn of entry.unregFns) {
              fn();
            }
          }
          serverRegistry.clear();
        }
      };
    },

    onGetSystemPrompt(
      _ctx: ToolSetContext,
      promptCtx: SystemPromptContext,
    ): string {
      // Base MCP system prompt — always present.
      const parts: string[] = [MCP_SYSTEM_PROMPT];

      // Prompt injection: when the user types `/mcp:<server>:<prompt>`,
      // fetch the prompt from the backend and inject its messages into
      // the system prompt so the LLM sees the resolved template content.
      const userMessage = promptCtx.userMessage;
      if (userMessage) {
        const mentions = parseSlashMentions(userMessage);
        const mcpMentions = mentions.filter((m) => m.startsWith('mcp:'));

        if (mcpMentions.length > 0) {
          // Build a set of available prompts for quick lookup.
          // The injection is synchronous — we can't await here, so we
          // inject a directive telling the LLM to use get_mcp_prompt.
          // The actual prompt content will be fetched by the tool call.
          const promptHints = mcpMentions.map((mention) => {
            const parts = mention.split(':');
            if (parts.length >= 3) {
              const serverName = parts[1];
              const promptName = parts.slice(2).join(':');
              return `- /${mention} → Use get_mcp_prompt with server="${serverName}" and name="${promptName}" to retrieve the prompt messages, then follow them as context for this conversation.`;
            }
            return `- /${mention}`;
          });
          parts.push(
            `\n## MCP Prompt Mentions\n\nThe user referenced the following MCP prompts:\n${promptHints.join('\n')}\n\nUse the get_mcp_prompt tool to retrieve each prompt's messages and incorporate them into your response.`,
          );
        }
      }

      return parts.join('\n\n');
    },
  };

  // ── Bridge Methods ─────────────────────────────────────────────────────

  const bridgeMethods: McpBridge = {
    sync: () => syncFromAdapter(),
    connect: async (name) => {
      const entry = store.getByName(name);
      if (entry) await connect(entry.id);
    },
    disconnect: (name) => {
      const entry = store.getByName(name);
      if (entry) disconnect(entry.id);
    },
    remove: (name) => {
      const entry = store.getByName(name);
      if (entry) remove(entry.id);
    },
    addServer: (config) => addServer(config),
    listResources: (serverName) => adapter.listResources(serverName),
    listResourceTemplates: (serverName) => adapter.listResourceTemplates(serverName),
    readResource: (serverName, uri) => adapter.readResource(serverName, uri),
    listPrompts: (serverName) => adapter.listPrompts(serverName),
    getPrompt: (serverName, promptName, args) => adapter.getPrompt(serverName, promptName, args),
  };

  return { toolSet: toolset, slotDeclarations, bridgeMethods };
}
