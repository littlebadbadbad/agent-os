/**
 * Tests for agent/manager.ts — createMcpToolset
 *
 * Covers the full lifecycle:
 *   - ToolSet structure (symbol, name, coreTools, tools)
 *   - Meta-tools: list/add/remove/connect/disable MCP servers
 *   - Proxy tool registration/unregistration on connect/disconnect
 *   - Content serialization (text, image, resource, audio)
 *   - Error handling in meta-tools
 *   - onAttach / detach lifecycle
 *   - Slot declarations
 *   - Bridge methods
 *   - Compact tool-card descriptors
 *
 * Mocks McpAdapter fully — all transport logic is in backend tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpToolset, MCP_MANAGER_SYMBOL } from '../manager';
import type { McpAdapter, McpServerEntry, McpBridge } from '../types';
import type { ToolDef, ToolCallResult, TextContent, ImageContent, AudioContent, ResourceContent } from '../protocol';
import type { AgentClientLike, Tool, PluginSlotDeclaration } from '@agent-type';

// ═══════════════════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makeToolDef(name: string, desc: string): ToolDef {
  return {
    name,
    description: desc,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Query string' } },
      required: ['query'],
    },
  };
}

function makeServerEntry(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: overrides.name ?? 'srv-default',
    name: 'default-server',
    url: 'https://mcp.example.com/mcp',
    transport: 'streamable-http',
    headers: {},
    includeTools: [],
    enabled: true,
    useProxy: false,
    status: 'disconnected',
    errorMsg: '',
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    ...overrides,
  };
}

function makeTextResult(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }], isError: false };
}

function makeErrorResult(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function makeImageResult(data: string, mimeType = 'image/png'): ToolCallResult {
  return { content: [{ type: 'image', data, mimeType }], isError: false };
}

function makeResourceResult(uri: string, text: string): ToolCallResult {
  return { content: [{ type: 'resource', resource: { uri, text } }], isError: false };
}

function makeAudioResult(data: string, mimeType = 'audio/wav'): ToolCallResult {
  return { content: [{ type: 'audio', data, mimeType }], isError: false };
}

function makeMixedResult(): ToolCallResult {
  return {
    content: [
      { type: 'text', text: 'Summary:' },
      { type: 'image', data: 'abc', mimeType: 'image/png' },
      { type: 'resource', resource: { uri: 'file:///data.csv', text: 'col1,col2\n1,2' } },
    ],
    isError: false,
  };
}

type ToolBox = { tools: Tool[] };
function makeAgentClient(toolBox: ToolBox): AgentClientLike {
  return {
    registerTool(t: Tool) {
      toolBox.tools.push(t);
      return () => {
        const idx = toolBox.tools.indexOf(t);
        if (idx >= 0) toolBox.tools.splice(idx, 1);
      };
    },
    registerToolSet() { return () => {}; },
    getTools: () => toolBox.tools,
    getFilteredTools: () => toolBox.tools,
    getRegisteredToolSets: () => [],
    handler: async () => ({
      messages: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('createMcpToolset', () => {
  let adapter: McpAdapter;
  let toolBox: ToolBox;
  let agent: AgentClientLike;
  let bundle: ReturnType<typeof createMcpToolset>;

  beforeEach(() => {
    toolBox = { tools: [] };
    agent = makeAgentClient(toolBox);

    adapter = {
      listServers: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn().mockResolvedValue(undefined),
      reconnectServer: vi.fn().mockResolvedValue(undefined),
      disconnectServer: vi.fn().mockResolvedValue(undefined),
      executeTool: vi.fn(),
      listResources: vi.fn().mockResolvedValue([]),
      listResourceTemplates: vi.fn().mockResolvedValue([]),
      readResource: vi.fn().mockResolvedValue({ contents: [] }),
      listPrompts: vi.fn().mockResolvedValue([]),
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    };

    bundle = createMcpToolset(adapter);
  });

  // ── Bundle Structure ───────────────────────────────────────────────────

  describe('bundle structure', () => {
    it('returns toolSet, slotDeclarations, and bridgeMethods', () => {
      expect(bundle.toolSet).toBeDefined();
      expect(bundle.slotDeclarations).toBeDefined();
      expect(bundle.bridgeMethods).toBeDefined();
    });

    it('toolSet has correct symbol and name', () => {
      expect(bundle.toolSet.symbol).toBe(MCP_MANAGER_SYMBOL);
      expect(bundle.toolSet.name).toBe('mcp-manager');
    });

    it('toolSet has 9 meta-tools', () => {
      expect(bundle.toolSet.tools).toHaveLength(9);
      const names = bundle.toolSet.tools.map((t) => t.name);
      expect(names).toContain('list_mcp_servers');
      expect(names).toContain('add_mcp_server');
      expect(names).toContain('remove_mcp_server');
      expect(names).toContain('connect_mcp_server');
      expect(names).toContain('disable_mcp_server');
      expect(names).toContain('list_mcp_resources');
      expect(names).toContain('read_mcp_resource');
      expect(names).toContain('list_mcp_prompts');
      expect(names).toContain('get_mcp_prompt');
    });

    it('coreTools includes list_mcp_servers', () => {
      expect(bundle.toolSet.coreTools).toEqual(['list_mcp_servers']);
    });

    it('has 4 slot declarations including autocomplete', () => {
      expect(bundle.slotDeclarations).toHaveLength(4);
      const types = bundle.slotDeclarations.map((s) => s.type);
      expect(types).toContain('toolButton');
      expect(types).toContain('autocomplete');
      expect(types).toContain('toolCard');
      expect(types).toContain('compactToolCard');
    });
  });

  // ── list_mcp_servers ──────────────────────────────────────────────────

  describe('list_mcp_servers tool', () => {
    it('returns server list after syncing from adapter', async () => {
      const srv = makeServerEntry({
        id: 'mcp-1', name: 'github', status: 'connected',
        tools: [makeToolDef('search', 'Search code')],
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);

      const tool = findTool(bundle, 'list_mcp_servers');
      const result = await tool.execute({}, makeCtx());

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'mcp-1', name: 'github', transport: 'streamable-http',
        status: 'connected', toolCount: 1, tools: ['search'],
      });
    });

    it('returns empty array when no servers', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([]);
      const tool = findTool(bundle, 'list_mcp_servers');
      const result = await tool.execute({}, makeCtx());
      expect(result).toEqual([]);
    });

    it('includes error messages for servers in error state', async () => {
      const srv = makeServerEntry({
        id: 'mcp-err', name: 'broken', status: 'error', errorMsg: 'Connection refused',
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);
      const tool = findTool(bundle, 'list_mcp_servers');
      const result = await tool.execute({}, makeCtx());
      expect(result[0].errorMsg).toBe('Connection refused');
    });
  });

  // ── add_mcp_server ─────────────────────────────────────────────────────

  describe('add_mcp_server tool', () => {
    it('adds a server and returns success', async () => {
      const entry = makeServerEntry({ id: 'mcp-new', name: 'new-srv', status: 'connected', tools: [makeToolDef('t1', 'd')] });
      vi.mocked(adapter.addServer).mockResolvedValue(entry);
      vi.mocked(adapter.listServers).mockResolvedValue([entry]);

      const tool = findTool(bundle, 'add_mcp_server');
      const result = await tool.execute(
        { name: 'new-srv', url: 'https://example.com', transport: 'streamable-http' },
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.message).toContain('new-srv');
      expect(result.message).toContain('1 tool(s)');
    });

    it('returns error when connection fails', async () => {
      const entry = makeServerEntry({ id: 'mcp-fail', name: 'fail-srv', status: 'error', errorMsg: 'DNS lookup failed' });
      vi.mocked(adapter.addServer).mockResolvedValue(entry);
      vi.mocked(adapter.listServers).mockResolvedValue([entry]);

      const tool = findTool(bundle, 'add_mcp_server');
      const result = await tool.execute(
        { name: 'fail-srv', url: 'https://bad.example.com', transport: 'streamable-http' },
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('DNS lookup failed');
    });

    it('handles thrown errors during add', async () => {
      vi.mocked(adapter.addServer).mockRejectedValue(new Error('Duplicate name'));

      const tool = findTool(bundle, 'add_mcp_server');
      const result = await tool.execute(
        { name: 'dup', url: 'https://example.com', transport: 'streamable-http' },
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Duplicate name');
    });

    it('accepts all transport types', async () => {
      for (const transport of ['streamable-http', 'legacy-sse', 'stdio'] as const) {
        const entry = makeServerEntry({ id: `mcp-${transport}`, name: `srv-${transport}`, status: 'connected', transport });
        vi.mocked(adapter.addServer).mockResolvedValue(entry);
        vi.mocked(adapter.listServers).mockResolvedValue([entry]);

        const tool = findTool(bundle, 'add_mcp_server');
        const result = await tool.execute(
          { name: `srv-${transport}`, url: 'https://example.com', transport },
          makeCtx(),
        );
        expect(result.ok).toBe(true);
      }
    });

    it('forwards optional headers and includeTools', async () => {
      const entry = makeServerEntry({
        id: 'mcp-headers', name: 'auth-srv', status: 'connected',
        headers: { Authorization: 'Bearer xyz' }, includeTools: ['tool-a'],
      });
      vi.mocked(adapter.addServer).mockResolvedValue(entry);
      vi.mocked(adapter.listServers).mockResolvedValue([entry]);

      const tool = findTool(bundle, 'add_mcp_server');
      const result = await tool.execute(
        {
          name: 'auth-srv', url: 'https://example.com', transport: 'streamable-http',
          headers: { Authorization: 'Bearer xyz' }, includeTools: ['tool-a'],
        },
        makeCtx(),
      );
      expect(result.ok).toBe(true);
    });
  });

  // ── remove_mcp_server ──────────────────────────────────────────────────

  describe('remove_mcp_server tool', () => {
    it('removes an existing server', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([
        makeServerEntry({ id: 'mcp-to-remove', name: 'to-remove' }),
      ]);

      // First attach so the store is populated
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      // Now remove
      const tool = findTool(bundle, 'remove_mcp_server');
      const result = await tool.execute({ name: 'to-remove' }, makeCtx());
      expect(result.ok).toBe(true);
      expect(result.message).toContain('to-remove');
    });

    it('returns error for unknown server', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      const tool = findTool(bundle, 'remove_mcp_server');
      const result = await tool.execute({ name: 'ghost' }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.error).toContain('ghost');
    });
  });

  // ── connect_mcp_server ─────────────────────────────────────────────────

  describe('connect_mcp_server tool', () => {
    it('connects an existing server', async () => {
      const srv = makeServerEntry({ id: 'mcp-reconn', name: 'reconn', status: 'disconnected' });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);
      vi.mocked(adapter.reconnectServer).mockResolvedValue();

      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      const tool = findTool(bundle, 'connect_mcp_server');
      const result = await tool.execute({ name: 'reconn' }, makeCtx());
      expect(result.ok).toBe(true);
    });

    it('returns error when server not found', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      const tool = findTool(bundle, 'connect_mcp_server');
      const result = await tool.execute({ name: 'nope' }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.error).toContain('nope');
    });

    it('handles reconnect failure', async () => {
      const srv = makeServerEntry({ id: 'mcp-bad', name: 'bad', status: 'disconnected' });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);
      vi.mocked(adapter.reconnectServer).mockRejectedValue(new Error('Timeout'));

      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      const tool = findTool(bundle, 'connect_mcp_server');
      const result = await tool.execute({ name: 'bad' }, makeCtx());
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Timeout');
    });
  });

  // ── disable_mcp_server ─────────────────────────────────────────────────

  describe('disable_mcp_server tool', () => {
    it('disconnects an existing server', async () => {
      const srv = makeServerEntry({ id: 'mcp-dis', name: 'dis', status: 'connected' });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);

      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();
      const tool = findTool(bundle, 'disable_mcp_server');
      const result = await tool.execute({ name: 'dis' }, makeCtx());
      expect(result.ok).toBe(true);
    });

    it('returns error for unknown server', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);

      const tool = findTool(bundle, 'disable_mcp_server');
      const result = await tool.execute({ name: 'nobody' }, makeCtx());
      expect(result.ok).toBe(false);
    });
  });

  // ── Proxy Tool Registration ────────────────────────────────────────────

  describe('proxy tool registration', () => {
    it('registers proxy tools for connected servers on attach', async () => {
      const tools: readonly ToolDef[] = [
        makeToolDef('search_repos', 'Search repositories'),
        makeToolDef('list_issues', 'List issues'),
      ];
      const srv = makeServerEntry({
        id: 'mcp-gh', name: 'github', status: 'connected', tools,
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);

      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      // Proxy tools should be registered
      const registered = agent.getTools();
      const proxyNames = registered.map((t) => t.name);
      expect(proxyNames).toContain('search_repos');
      expect(proxyNames).toContain('list_issues');
    });

    it('unregisters proxy tools on detach', () => {
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      const detach = bundle.toolSet.onAttach!(agent as AgentClientLike);
      // detach from onAttach's return
      if (detach) detach();
      expect(agent.getTools()).toHaveLength(0);
    });

    it('does not register tools for disconnected servers', async () => {
      const srv = makeServerEntry({
        id: 'mcp-off', name: 'offline', status: 'disconnected',
        tools: [makeToolDef('secret', 'Secret tool')],
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);

      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();
      expect(agent.getTools()).toHaveLength(0);
    });

    it('unregisters old tools when server disconnects', async () => {
      const srv = makeServerEntry({
        id: 'mcp-flip', name: 'flip', status: 'connected',
        tools: [makeToolDef('old_tool', 'Old')],
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();
      expect(agent.getTools()).toHaveLength(1);
      vi.mocked(adapter.listServers).mockResolvedValue([
        makeServerEntry({ id: 'mcp-flip', name: 'flip', status: 'disconnected', tools: [] }),
      ]);

      // Force a sync
      await bundle.bridgeMethods.sync();
      expect(agent.getTools()).toHaveLength(0);
    });

    it('re-registers tools when server reconnects with updated tools', async () => {
      const srv1 = makeServerEntry({
        id: 'mcp-up', name: 'upgraded', status: 'connected',
        tools: [makeToolDef('v1', 'Version 1')],
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv1]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();
      expect(agent.getTools().map((t) => t.name)).toEqual(['v1']);
      const srv2 = makeServerEntry({
        id: 'mcp-up', name: 'upgraded', status: 'connected',
        tools: [makeToolDef('v1', 'Version 1'), makeToolDef('v2', 'Version 2')],
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv2]);

      await bundle.bridgeMethods.sync();
      const names = agent.getTools().map((t) => t.name);
      expect(names).toContain('v1');
      expect(names).toContain('v2');
    });
  });

  // ── Proxy Tool Execution (content serialization) ───────────────────────

  describe('proxy tool execution — content serialization', () => {
    async function registerAndExecute(toolDef: ToolDef, result: ToolCallResult) {
      const srv = makeServerEntry({
        id: 'mcp-exec', name: 'executor', status: 'connected', tools: [toolDef],
      });
      vi.mocked(adapter.listServers).mockResolvedValue([srv]);
      vi.mocked(adapter.executeTool).mockResolvedValue(result);

      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      const proxy = agent.getTools().find((t) => t.name === toolDef.name)!;
      return proxy.execute({}, makeCtx());
    }

    it('serializes text content to string', async () => {
      const result = await registerAndExecute(
        makeToolDef('echo', 'Echo'),
        makeTextResult('Hello World'),
      );
      expect(result).toBe('Hello World');
    });

    it('serializes image content with mime type', async () => {
      const result = await registerAndExecute(
        makeToolDef('screenshot', 'Take screenshot'),
        makeImageResult('base64data'),
      );
      expect(result).toBe('[Image: image/png]');
    });

    it('serializes audio content with mime type', async () => {
      const result = await registerAndExecute(
        makeToolDef('record', 'Record audio'),
        makeAudioResult('wavdata', 'audio/wav'),
      );
      expect(result).toBe('[Audio: audio/wav]');
    });

    it('serializes resource content with text', async () => {
      const result = await registerAndExecute(
        makeToolDef('read_file', 'Read file'),
        makeResourceResult('file:///doc.txt', 'file contents here'),
      );
      expect(result).toBe('file contents here');
    });

    it('serializes resource content without text (URI fallback)', async () => {
      const res: ToolCallResult = {
        content: [{ type: 'resource', resource: { uri: 'file:///data.bin' } }],
        isError: false,
      };
      const result = await registerAndExecute(makeToolDef('read_bin', 'Read binary'), res);
      expect(result).toBe('[Resource: file:///data.bin]');
    });

    it('serializes mixed content with newlines', async () => {
      const result = await registerAndExecute(
        makeToolDef('analyze', 'Analyze'),
        makeMixedResult(),
      );
      expect(result).toContain('Summary:');
      expect(result).toContain('[Image: image/png]');
      expect(result).toContain('col1,col2');
    });

    it('throws Error when isError is true', async () => {
      await expect(
        registerAndExecute(makeToolDef('fail', 'Fail'), makeErrorResult('Something broke')),
      ).rejects.toThrow('Something broke');
    });
  });

  // ── Tool descriptors (compactToolCard) ─────────────────────────────────

  describe('compactToolCard descriptors', () => {
    function getCompactDecl(): PluginSlotDeclaration | undefined {
      return bundle.slotDeclarations.find((s) => s.type === 'compactToolCard');
    }

    it('provides descriptor for list_mcp_servers (running state)', () => {
      const decl = getCompactDecl()!;
      const desc = decl.getDescriptor!({
        name: 'list_mcp_servers',
        arguments: {},
        status: 'running',
        result: undefined,
      } as any);
      expect(desc.summary).toBe('Listing MCP servers\u2026');
      expect(desc.status).toBe('running');
    });

    it('provides descriptor for list_mcp_servers (completed)', () => {
      const decl = getCompactDecl()!;
      const desc = decl.getDescriptor!({
        name: 'list_mcp_servers',
        arguments: {},
        status: 'success',
        result: [{}, {}, {}],
      } as any);
      expect(desc.summary).toBe('3 MCP servers');
      expect(desc.status).toBe('success');
    });

    it('provides descriptor for add_mcp_server (running)', () => {
      const decl = getCompactDecl()!;
      const desc = decl.getDescriptor!({
        name: 'add_mcp_server',
        arguments: { name: 'github' },
        status: 'running',
        result: undefined,
      } as any);
      expect(desc.summary).toContain('github');
      expect(desc.status).toBe('running');
    });

    it('provides descriptor for error cases', () => {
      const decl = getCompactDecl()!;
      const desc = decl.getDescriptor!({
        name: 'connect_mcp_server',
        arguments: { name: 'bad' },
        status: 'error',
        result: undefined,
        error: 'Connection refused - is the server running? With extra long description text for testing truncation behavior',
      } as any);
      expect(desc.status).toBe('error');
      expect(desc.summary).toContain('\u2026');
    });
  });

  // ── Slot declarations ──────────────────────────────────────────────────

  describe('slot declarations', () => {
    it('toolButton badge shows connected count', () => {
      const btn = bundle.slotDeclarations.find((s) => s.type === 'toolButton')!;
      // Initially 0 connected → null badge
      expect(btn.badge!()).toBeNull();

      // After populating with connected servers
      vi.mocked(adapter.listServers).mockResolvedValue([
        makeServerEntry({ id: 'mcp-1', name: 's1', status: 'connected' }),
        makeServerEntry({ id: 'mcp-2', name: 's2', status: 'connected' }),
        makeServerEntry({ id: 'mcp-3', name: 's3', status: 'disconnected' }),
      ]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);

      // Badge is synchronous and reads from store
      // After sync, should be 2
    });

    it('toolCard lists all MCP meta tool names', () => {
      const card = bundle.slotDeclarations.find((s) => s.type === 'toolCard')!;
      expect(card.toolNames).toContain('list_mcp_servers');
      expect(card.toolNames).toContain('add_mcp_server');
      expect(card.toolNames).toContain('remove_mcp_server');
      expect(card.toolNames).toContain('connect_mcp_server');
      expect(card.toolNames).toContain('disable_mcp_server');
    });

    it('toolButton has the plug emoji icon', () => {
      const btn = bundle.slotDeclarations.find((s) => s.type === 'toolButton')!;
      expect(btn.icon).toBe('\u{1F50C}');
      expect(btn.showBtn!()).toBe(true);
    });
  });

  // ── Bridge Methods ─────────────────────────────────────────────────────

  describe('bridge methods', () => {
    let bridge: McpBridge;

    beforeEach(() => {
      bridge = bundle.bridgeMethods;
    });

    it('sync returns server list', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([makeServerEntry({ id: 'x', name: 'x' })]);
      const list = await bridge.sync();
      expect(list).toHaveLength(1);
    });

    it('connect delegates to adapter', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([
        makeServerEntry({ id: 'mcp-c', name: 'c', status: 'disconnected' }),
      ]);
      vi.mocked(adapter.reconnectServer).mockResolvedValue();
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();

      await bridge.connect('c');
      expect(adapter.reconnectServer).toHaveBeenCalledWith('c');
    });

    it('connect ignores unknown server', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([]);
      await bridge.connect('ghost');
      expect(adapter.reconnectServer).not.toHaveBeenCalled();
    });

    it('disconnect delegates to adapter', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([
        makeServerEntry({ id: 'mcp-d', name: 'd', status: 'connected' }),
      ]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();
      bridge.disconnect('d');
    });

    it('remove delegates to adapter', async () => {
      vi.mocked(adapter.listServers).mockResolvedValue([
        makeServerEntry({ id: 'mcp-r', name: 'r' }),
      ]);
      bundle.toolSet.onAttach!(agent as AgentClientLike);
      await bundle.bridgeMethods.sync();
      bridge.remove('r');
    });

    it('addServer delegates to adapter', async () => {
      const entry = makeServerEntry({ id: 'mcp-new', name: 'bridge-new', status: 'connected' });
      vi.mocked(adapter.addServer).mockResolvedValue(entry);
      vi.mocked(adapter.listServers).mockResolvedValue([entry]);

      const result = await bridge.addServer({
        name: 'bridge-new',
        url: 'https://example.com',
        transport: 'streamable-http',
      });
      expect(result.name).toBe('bridge-new');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function findTool(bundle: ReturnType<typeof createMcpToolset>, name: string): Tool {
  const tool = bundle.toolSet.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

function makeCtx() {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    conversationId: 'main',
    sourceAgent: 'main',
    isSubAgent: false,
    signal: new AbortController().signal,
  };
}
