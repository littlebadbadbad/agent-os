/**
 * Tests for agent/pluginAdapter.ts — McpPluginAdapter
 *
 * Covers:
 *   - listServers: delegates to apiClient.call('listServers')
 *   - addServer: delegates with full config
 *   - removeServer / reconnectServer / disconnectServer: delegates
 *   - executeTool: forwards structured ToolCallResult
 *   - typed generic call pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpPluginAdapter } from '../pluginAdapter';
import type { PluginApiClient } from '@agent-type';
import type { McpServerConfig, McpServerEntry } from '../types';
import type { ToolCallResult, TextContent, ImageContent } from '../protocol';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTextResult(text: string, isError = false): ToolCallResult {
  return {
    content: [{ type: 'text' as const, text }],
    isError,
  };
}

function makeImageResult(mimeType: string, data: string): ToolCallResult {
  return {
    content: [{ type: 'image' as const, mimeType, data }],
    isError: false,
  };
}

function makeMixedResult(): ToolCallResult {
  return {
    content: [
      { type: 'text' as const, text: 'Here is the chart:' },
      { type: 'image' as const, mimeType: 'image/png', data: 'base64fake==' },
    ],
    isError: false,
  };
}

function makeServerEntry(name: string): McpServerEntry {
  return {
    id: 'srv-001',
    name,
    url: 'https://example.com/mcp',
    transport: 'streamable-http',
    headers: {},
    includeTools: [],
    enabled: true,
    useProxy: false,
    status: 'connected',
    errorMsg: '',
    tools: [{ name: 'tool-a', description: 'desc', inputSchema: { type: 'object', properties: {} } }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpPluginAdapter', () => {
  let apiClient: PluginApiClient;
  let adapter: ReturnType<typeof createMcpPluginAdapter>;

  beforeEach(() => {
    apiClient = {
      call: vi.fn(),
    } as unknown as PluginApiClient;
    adapter = createMcpPluginAdapter(apiClient);
  });

  describe('listServers', () => {
    it('returns servers from backend response', async () => {
      const entry = makeServerEntry('github');
      vi.mocked(apiClient.call).mockResolvedValue({ servers: [entry] });

      const result = await adapter.listServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('github');
    });

    it('returns empty array when backend has no servers', async () => {
      vi.mocked(apiClient.call).mockResolvedValue({ servers: [] });
      const result = await adapter.listServers();
      expect(result).toEqual([]);
    });
  });

  describe('addServer', () => {
    it('sends full config and returns the entry', async () => {
      const entry = makeServerEntry('new-server');
      vi.mocked(apiClient.call).mockResolvedValue(entry);

      const config: McpServerConfig = {
        name: 'new-server',
        url: 'https://new.example.com',
        transport: 'legacy-sse',
        headers: { Authorization: 'Bearer token123' },
        includeTools: ['tool-a', 'tool-b'],
        useProxy: true,
      };

      const result = await adapter.addServer(config);
      expect(result.name).toBe('new-server');
      expect(apiClient.call).toHaveBeenCalledWith('addServer', expect.objectContaining({
        name: 'new-server',
        transport: 'legacy-sse',
      }));
    });
  });

  describe('removeServer', () => {
    it('delegates to apiClient.call', async () => {
      vi.mocked(apiClient.call).mockResolvedValue(undefined);
      await adapter.removeServer('old-server');
      expect(apiClient.call).toHaveBeenCalledWith('removeServer', { name: 'old-server' });
    });
  });

  describe('reconnectServer', () => {
    it('delegates reconnect', async () => {
      vi.mocked(apiClient.call).mockResolvedValue(undefined);
      await adapter.reconnectServer('reconn');
      expect(apiClient.call).toHaveBeenCalledWith('reconnectServer', { name: 'reconn' });
    });
  });

  describe('disconnectServer', () => {
    it('delegates disconnect', async () => {
      vi.mocked(apiClient.call).mockResolvedValue(undefined);
      await adapter.disconnectServer('dc');
      expect(apiClient.call).toHaveBeenCalledWith('disconnectServer', { name: 'dc' });
    });
  });

  describe('executeTool', () => {
    it('returns structured ToolCallResult for text content', async () => {
      vi.mocked(apiClient.call).mockResolvedValue({ result: makeTextResult('Hello, World!') });

      const result = await adapter.executeTool(
        'my-server',
        'echo',
        { message: 'Hello' },
        'session-1',
        new AbortController().signal,
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const textBlock = result.content[0] as TextContent;
      expect(textBlock.text).toBe('Hello, World!');
      expect(result.isError).toBe(false);
    });

    it('returns structured ToolCallResult for image content', async () => {
      vi.mocked(apiClient.call).mockResolvedValue({ result: makeImageResult('image/png', 'iVBORw0KGgo=') });

      const result = await adapter.executeTool(
        'img-server', 'generate', { prompt: 'cat' }, 's1',
        new AbortController().signal,
      );

      expect(result.content[0].type).toBe('image');
      const imgBlock = result.content[0] as ImageContent;
      expect(imgBlock.mimeType).toBe('image/png');
      expect(imgBlock.data).toBe('iVBORw0KGgo=');
    });

    it('returns mixed content types', async () => {
      vi.mocked(apiClient.call).mockResolvedValue({ result: makeMixedResult() });

      const result = await adapter.executeTool(
        'mixed', 'chart', {}, 's1', new AbortController().signal,
      );

      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('text');
      expect(result.content[1].type).toBe('image');
    });

    it('passes tool error flag through', async () => {
      vi.mocked(apiClient.call).mockResolvedValue({
        result: makeTextResult('Rate limit exceeded', true),
      });

      const result = await adapter.executeTool(
        'api', 'call', {}, 's1', new AbortController().signal,
      );

      expect(result.isError).toBe(true);
      const tb = result.content[0] as TextContent;
      expect(tb.text).toBe('Rate limit exceeded');
    });

    it('forwards sessionId in params', async () => {
      vi.mocked(apiClient.call).mockResolvedValue({ result: makeTextResult('ok') });
      await adapter.executeTool('srv', 'tool', {}, 'my-session-42', new AbortController().signal);
      expect(apiClient.call).toHaveBeenCalledWith('executeTool', expect.objectContaining({
        sessionId: 'my-session-42',
      }));
    });
  });
});
