import type {
  DynamicToolAdapter,
  DynamicToolEntry,
  DynamicModuleEntry,
  DependencyInfo,
  InstallDepsResult,
  RemoveDepResult,
  HttpDynamicToolAdapterConfig,
  DynamicToolSerializableContext,
} from './types';

// ── HTTP fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// ── HTTP adapter factory ──────────────────────────────────────────────────────

/**
 * Create a `DynamicToolAdapter` that talks to the Agent SDK backend REST API.
 *
 * Routes used:
 *   GET    /tools                      — list tools
 *   POST   /tools                      — create a tool
 *   PATCH  /tools/:name                — partial-update a tool
 *   DELETE /tools/:name                — delete a tool
 *   POST   /execute-tool               — run a backend tool
 *   GET    /tool-modules               — list modules
 *   POST   /tool-modules               — create/update a module
 *   GET    /tool-modules/:name         — get module with content
 *   PATCH  /tool-modules/:name         — partial-update a module
 *   DELETE /tool-modules/:name         — delete a module
 *   GET    /tool-deps                  — list installed deps
 *   POST   /tool-deps/install          — install npm packages
 *   DELETE /tool-deps/:pkg             — remove an npm package
 */
export function createHttpDynamicToolAdapter(
  config: HttpDynamicToolAdapterConfig = {},
): DynamicToolAdapter {
  const base = (config.baseUrl ?? '/api').replace(/\/$/, '');

  return {
    // ── Tool CRUD ────────────────────────────────────────────────────────────

    async listTools() {
      const data = await apiFetch<{ tools: DynamicToolEntry[] }>(`${base}/tools`);
      return data.tools ?? [];
    },

    async createTool(entry) {
      const data = await apiFetch<{ tool: DynamicToolEntry }>(`${base}/tools`, {
        method: 'POST',
        body: JSON.stringify({
          name:           entry.name,
          description:    entry.description,
          parameters:     entry.parameters,
          implementation: entry.implementation,
          runtime:        entry.runtime,
        }),
      });
      return data.tool;
    },

    async updateTool(name, patch) {
      const data = await apiFetch<{ tool: DynamicToolEntry }>(
        `${base}/tools/${encodeURIComponent(name)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            ...(patch.description    !== undefined && { description:    patch.description }),
            ...(patch.parameters     !== undefined && { parameters:     patch.parameters }),
            ...(patch.implementation !== undefined && { implementation: patch.implementation }),
            ...(patch.runtime        !== undefined && { runtime:        patch.runtime }),
          }),
        },
      );
      return data.tool;
    },

    async deleteTool(name) {
      await apiFetch(`${base}/tools/${encodeURIComponent(name)}`, { method: 'DELETE' });
    },

    async executeTool(name, args, ctx?: DynamicToolSerializableContext) {
      const data = await apiFetch<{ result: unknown }>(`${base}/execute-tool`, {
        method: 'POST',
        body: JSON.stringify({ name, arguments: args, ...(ctx ?? {}) }),
      });
      return data.result;
    },

    // ── Module CRUD ──────────────────────────────────────────────────────────

    async listModules() {
      const data = await apiFetch<{ modules: DynamicModuleEntry[] }>(`${base}/tool-modules`);
      return data.modules ?? [];
    },

    async getModule(name) {
      return apiFetch<DynamicModuleEntry & { content: string }>(
        `${base}/tool-modules/${encodeURIComponent(name)}`,
      );
    },

    async createModule(entry) {
      const data = await apiFetch<{ created: string }>(`${base}/tool-modules`, {
        method: 'POST',
        body: JSON.stringify(entry),
      });
      return { name: data.created, description: entry.description };
    },

    async updateModule(name, patch) {
      await apiFetch(`${base}/tool-modules/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    async deleteModule(name) {
      await apiFetch(`${base}/tool-modules/${encodeURIComponent(name)}`, { method: 'DELETE' });
    },

    // ── npm dependency management ────────────────────────────────────────────

    async listDeps() {
      return apiFetch<DependencyInfo>(`${base}/tool-deps`);
    },

    async installDeps(packages) {
      return apiFetch<InstallDepsResult>(`${base}/tool-deps/install`, {
        method: 'POST',
        body: JSON.stringify({ packages }),
      });
    },

    async removeDep(pkg) {
      return apiFetch<RemoveDepResult>(
        `${base}/tool-deps/${encodeURIComponent(pkg)}`,
        { method: 'DELETE' },
      );
    },
  };
}
