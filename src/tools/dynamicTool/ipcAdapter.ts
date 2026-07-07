/**
 * src/tools/dynamicTool/ipcAdapter.ts — Electron IPC adapter for dynamic tool management
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 */

import type {
  DynamicToolAdapter,
  DynamicToolEntry,
  DynamicModuleEntry,
  DependencyInfo,
  InstallDepsResult,
  RemoveDepResult,
  DynamicToolSerializableContext,
} from './types';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcDynamicToolAdapterConfig = Record<string, never>;

// ── IPC adapter factory ──────────────────────────────────────────────────────

/**
 * Create a `DynamicToolAdapter` that talks to the Agent SDK backend via
 * Electron IPC instead of HTTP REST.
 *
 * @example
 * ```ts
 * const adapter = createIpcDynamicToolAdapter();
 * ```
 */
export function createIpcDynamicToolAdapter(
  _config: IpcDynamicToolAdapterConfig = {},
): DynamicToolAdapter {
  const invoke = window.electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcDynamicToolAdapter: window.electronAPI.invoke is not available');
  }

  return {
    // ── Tool CRUD ────────────────────────────────────────────────────────────

    async listTools() {
      const data = await invoke('tools:list') as { tools: DynamicToolEntry[] };
      return data.tools ?? [];
    },

    async createTool(entry) {
      const data = await invoke('tools:create', {
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters,
        implementation: entry.implementation,
        runtime: entry.runtime,
      }) as { tool: DynamicToolEntry };
      return data.tool;
    },

    async updateTool(name, patch) {
      return invoke('tools:update', { name, patch }) as Promise<DynamicToolEntry>;
    },

    async deleteTool(name) {
      await invoke('tools:delete', { name });
    },

    async executeTool(name, args, ctx?: DynamicToolSerializableContext) {
      const data = await invoke('tools:execute', { name, args, ctx }) as { result: unknown };
      return data.result;
    },

    // ── Module CRUD ──────────────────────────────────────────────────────────

    async listModules() {
      const data = await invoke('toolModules:list') as { modules: DynamicModuleEntry[] };
      return data.modules ?? [];
    },

    async getModule(name) {
      return invoke('toolModules:get', { name }) as Promise<DynamicModuleEntry & { content: string }>;
    },

    async createModule(entry) {
      const data = await invoke('toolModules:create', entry) as { created: string };
      return { name: data.created, description: entry.description };
    },

    async updateModule(name, patch) {
      await invoke('toolModules:update', { name, patch });
    },

    async deleteModule(name) {
      await invoke('toolModules:delete', { name });
    },

    // ── Dep management ───────────────────────────────────────────────────────

    async listDeps() {
      return invoke('toolDeps:list') as Promise<DependencyInfo>;
    },

    async installDeps(packages: string[]) {
      return invoke('toolDeps:install', { packages }) as Promise<InstallDepsResult>;
    },

    async removeDep(pkg: string) {
      return invoke('toolDeps:remove', { pkg }) as Promise<RemoveDepResult>;
    },
  };
}
