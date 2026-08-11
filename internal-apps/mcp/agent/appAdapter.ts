/**
 * internal-apps/mcp/agent/appAdapter.ts — McpAdapter factory
 *
 * Wraps a pre-bound AppApiClient into the McpAdapter interface.
 * This is how the MCP app's ToolSet communicates with its backend
 * via host.apiClient.call(method, params).
 */

import type { McpAdapter, McpServerEntry, McpServerConfig } from './types';
import type {
  ToolCallResult,
  ResourceDef,
  ResourceTemplateDef,
  ResourceReadResult,
  PromptDef,
  PromptGetResult,
} from './protocol';
import type { AppApiClient } from '@agent-type';

interface ListServersResponse {
  readonly servers: readonly McpServerEntry[];
}

interface ExecuteToolResponse {
  readonly result: ToolCallResult;
}

interface ListResourcesResponse {
  readonly resources: readonly ResourceDef[];
}

interface ListResourceTemplatesResponse {
  readonly templates: readonly ResourceTemplateDef[];
}

interface ReadResourceResponse {
  readonly result: ResourceReadResult;
}

interface ListPromptsResponse {
  readonly prompts: readonly PromptDef[];
}

interface GetPromptResponse {
  readonly result: PromptGetResult;
}

/**
 * Creates an McpAdapter that delegates all calls to a backend app
 * via a pre-bound AppApiClient.
 */
export function createMcpAppAdapter(apiClient: AppApiClient): McpAdapter {
  return {
    async listServers() {
      const res = await apiClient.call<ListServersResponse>('listServers');
      return res.servers;
    },

    async addServer(config: McpServerConfig) {
      return apiClient.call<McpServerEntry>('addServer', { ...config } as Record<string, unknown>);
    },

    async removeServer(name: string) {
      await apiClient.call('removeServer', { name });
    },

    async reconnectServer(name: string) {
      await apiClient.call('reconnectServer', { name });
    },

    async disconnectServer(name: string) {
      await apiClient.call('disconnectServer', { name });
    },

    async executeTool(
      serverName: string,
      toolName: string,
      args: Record<string, unknown>,
      sessionId: string,
      _signal: AbortSignal,
    ) {
      const res = await apiClient.call<ExecuteToolResponse>('executeTool', {
        server: serverName,
        tool: toolName,
        args,
        sessionId,
      });
      return res.result;
    },

    async listResources(serverName: string) {
      const res = await apiClient.call<ListResourcesResponse>('listResources', { server: serverName });
      return res.resources;
    },

    async listResourceTemplates(serverName: string) {
      const res = await apiClient.call<ListResourceTemplatesResponse>('listResourceTemplates', { server: serverName });
      return res.templates;
    },

    async readResource(serverName: string, uri: string) {
      const res = await apiClient.call<ReadResourceResponse>('readResource', { server: serverName, uri });
      return res.result;
    },

    async listPrompts(serverName: string) {
      const res = await apiClient.call<ListPromptsResponse>('listPrompts', { server: serverName });
      return res.prompts;
    },

    async getPrompt(serverName: string, promptName: string, args?: Record<string, string>) {
      const res = await apiClient.call<GetPromptResponse>('getPrompt', {
        server: serverName,
        name: promptName,
        arguments: args,
      });
      return res.result;
    },
  };
}
