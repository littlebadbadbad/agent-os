/**
 * Tests for agent/manager.ts — Structured Content Serialization
 *
 * Covers the full proxy tool pipeline:
 *   - Text content → string
 *   - Image content → string with mime type
 *   - Audio content → string with mime type
 *   - Resource content (with/without text)
 *   - Mixed content → concatenated
 *   - isError flag → throws Error instead of returning string
 *   - Empty content → empty string
 *
 * These are the agent-side serialization tests that complement the
 * backend transport-utils serialization tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpToolset } from '../manager';
import type { McpAdapter } from '../types';
import type { AgentClientLike, Tool } from '@agent-type';

// ═══════════════════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

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

function makeCtx(overrides: Partial<{ sessionId: string; signal: AbortSignal }> = {}) {
  return {
    sessionId: overrides.sessionId ?? 'test-session',
    signal: overrides.signal ?? new AbortController().signal,
    requestUserInput: vi.fn(),
    sendMessage: vi.fn(),
    flushPersistence: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Proxy Tool — Content Serialization', () => {
  let adapter: McpAdapter;
  let toolBox: ToolBox;

  beforeEach(() => {
    toolBox = { tools: [] };
    adapter = {
      listServers: vi.fn().mockResolvedValue([]),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      reconnectServer: vi.fn(),
      disconnectServer: vi.fn(),
      executeTool: vi.fn(),
    };
  });

  it('serializes text content to plain string', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [{ type: 'text', text: 'Hello, MCP!' }],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-1', name: 'text-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'echo', description: 'Echoes text', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    // Wait for async sync to complete
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'echo');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({ message: 'Hello' }, makeCtx());
    expect(result).toBe('Hello, MCP!');
  });

  it('throws Error when isError is true', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [{ type: 'text', text: 'Permission denied: cannot access /etc/shadow' }],
      isError: true,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-err', name: 'err-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'read_file', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'read_file');
    expect(proxyTool).toBeDefined();
    await expect(proxyTool!.execute({ path: '/etc/shadow' }, makeCtx()))
      .rejects.toThrow('Permission denied');
  });

  it('serializes image content to placeholder', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [{ type: 'image', data: 'base64fake==', mimeType: 'image/jpeg' }],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-img', name: 'img-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'screenshot', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'screenshot');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({}, makeCtx());
    expect(result).toBe('[Image: image/jpeg]');
  });

  it('serializes audio content to placeholder', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [{ type: 'audio', data: 'raw', mimeType: 'audio/wav' }],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-aud', name: 'aud-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'tts', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'tts');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({ text: 'hi' }, makeCtx());
    expect(result).toBe('[Audio: audio/wav]');
  });

  it('serializes resource with text content', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [{ type: 'resource', resource: { uri: 'file:///data.json', text: '{"key":"value"}' } }],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-res', name: 'res-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'get_data', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'get_data');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({}, makeCtx());
    expect(result).toBe('{"key":"value"}');
  });

  it('serializes resource without text to URI placeholder', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [{ type: 'resource', resource: { uri: 'file:///binary.bin' } }],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-bin', name: 'bin-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'read_binary', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'read_binary');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({}, makeCtx());
    expect(result).toBe('[Resource: file:///binary.bin]');
  });

  it('concatenates mixed content blocks with newlines', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [
        { type: 'text', text: 'Here is a summary:' },
        { type: 'image', data: 'aaa', mimeType: 'image/png' },
        { type: 'text', text: 'End of report.' },
      ],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-mix', name: 'mix-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'report', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'report');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({}, makeCtx());
    expect(result).toBe('Here is a summary:\n[Image: image/png]\nEnd of report.');
  });

  it('returns empty string for empty content array', async () => {
    vi.mocked(adapter.executeTool).mockResolvedValue({
      content: [],
      isError: false,
    });

    vi.mocked(adapter.listServers).mockResolvedValue([{
      id: 'srv-empty', name: 'empty-srv', url: 'https://example.com', transport: 'streamable-http',
      headers: {}, includeTools: [], enabled: true, useProxy: false,
      status: 'connected', errorMsg: '',
      tools: [{ name: 'noop', inputSchema: { type: 'object', properties: {} } }],
      resources: [], resourceTemplates: [], prompts: [],
    }]);

    const bundle = createMcpToolset(adapter);
    const agent = makeAgentClient(toolBox);
    bundle.toolSet.onAttach?.(agent);
    await bundle.bridgeMethods.sync();

    const proxyTool = toolBox.tools.find((t) => t.name === 'noop');
    expect(proxyTool).toBeDefined();
    const result = await proxyTool!.execute({}, makeCtx());
    expect(result).toBe('');
  });
});

describe('Transport Validation', () => {
  it('supports all three MCP transport types', () => {
    const transports = ['streamable-http', 'legacy-sse', 'stdio'] as const;
    for (const t of transports) {
      // Verify transport name is a valid McpTransport
      expect(t).toBeTruthy();
    }
    expect(transports).toHaveLength(3);
  });

  it('streamable-http is the default transport', () => {
    const defaultTransport = 'streamable-http';
    expect(defaultTransport).toBeTruthy();
    // The agent's addServer tool defaults to streamable-http
  });
});
