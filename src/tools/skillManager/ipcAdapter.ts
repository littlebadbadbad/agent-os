/**
 * src/tools/skillManager/ipcAdapter.ts — Electron IPC adapter for skill management
 *
 * Uses window.electronAPI.invoke() instead of HTTP fetch.
 */

import type { BackendSkill, SkillManagerAdapter } from './types';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcSkillAdapterConfig = Record<string, never>;

// ── IPC adapter factory ──────────────────────────────────────────────────────

/**
 * Create a `SkillManagerAdapter` that talks to the Agent SDK backend via
 * Electron IPC instead of HTTP REST.
 *
 * @example
 * ```ts
 * const adapter = createIpcSkillAdapter();
 * const { syncSkills, tools } = createSkillManager(agents, adapter);
 * ```
 */
export function createIpcSkillAdapter(
  _config: IpcSkillAdapterConfig = {},
): SkillManagerAdapter {
  const invoke = (window as any).electronAPI?.invoke;
  if (!invoke) {
    throw new Error('createIpcSkillAdapter: window.electronAPI.invoke is not available');
  }

  return {
    async listSkills() {
      const data = await invoke('skills:list') as { skills: BackendSkill[] };
      return data.skills ?? [];
    },

    async installSkill({ url, name, content }) {
      return invoke('skills:install', { url, name, content }) as Promise<{ installed: string; message: string }>;
    },

    async removeSkill(name) {
      return invoke('skills:remove', { name }) as Promise<{ deleted: string }>;
    },

    async readSkillFile(skill, path) {
      return invoke('skills:readFile', { name: skill, path }) as Promise<{ content: string; path: string }>;
    },
  };
}
