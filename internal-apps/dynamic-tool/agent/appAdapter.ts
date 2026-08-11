/**
 * internal-apps/dynamic-tool/agent/appAdapter.ts — Dynamic tool app adapter
 *
 * Implements DynamicToolAdapter using a pre-bound AppApiClient.
 */

import type { AppApiClient } from '@agent-type';
import type {
  DynamicToolAdapter,
  DynamicToolEntry,
  DynamicModuleEntry,
  DependencyInfo,
  InstallDepsResult,
  RemoveDepResult,
  DynamicToolSerializableContext,
} from './types';

export function createDynamicToolAppAdapter(apiClient: AppApiClient): DynamicToolAdapter {
  return {
    async listTools() {
      const data = await apiClient.call<{ tools: DynamicToolEntry[] }>('listTools');
      return data.tools ?? [];
    },

    async createTool(entry) {
      const data = await apiClient.call<{ tool: DynamicToolEntry }>('createTool', {
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters,
        implementation: entry.implementation,
        runtime: entry.runtime,
      });
      return data.tool;
    },

    async updateTool(name, patch) {
      const data = await apiClient.call<{ tool: DynamicToolEntry }>('updateTool', {
        name,
        description: patch.description,
        parameters: patch.parameters,
        implementation: patch.implementation,
        runtime: patch.runtime,
      });
      return data.tool;
    },

    async deleteTool(name) {
      await apiClient.call('deleteTool', { name });
    },

    async executeTool(name, args, ctx) {
      const data = await apiClient.call<{ result: unknown }>('executeTool', {
        name,
        arguments: args,
        sessionId: ctx?.sessionId,
        agentName: ctx?.agentName,
        conversationId: ctx?.conversationId,
      });
      return data.result;
    },

    async listModules() {
      const data = await apiClient.call<{ modules: DynamicModuleEntry[] }>('listModules');
      return data.modules ?? [];
    },

    async getModule(name) {
      return apiClient.call<DynamicModuleEntry & { content: string }>('getModule', { name });
    },

    async createModule(entry) {
      const data = await apiClient.call<{ created: string }>('createModule', entry);
      return { name: data.created, description: entry.description };
    },

    async updateModule(name, patch) {
      await apiClient.call('updateModule', { name, ...patch });
    },

    async deleteModule(name) {
      await apiClient.call('deleteModule', { name });
    },

    async listDeps() {
      return apiClient.call<DependencyInfo>('listDeps');
    },

    async installDeps(packages) {
      return apiClient.call<InstallDepsResult>('installDeps', { packages });
    },

    async removeDep(pkg) {
      return apiClient.call<RemoveDepResult>('removeDep', { package: pkg });
    },
  };
}
