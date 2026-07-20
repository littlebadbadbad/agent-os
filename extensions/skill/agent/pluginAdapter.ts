/**
 * extensions/skill/agent/pluginAdapter.ts — SkillManagerAdapter factory
 *
 * Wraps a pre-bound PluginApiClient into the SkillManagerAdapter interface.
 * This is how the skill plugin's ToolSet communicates with its backend
 * via host.apiClient.call(method, params) — no pluginId needed because
 * the apiClient is pre-bound at construction time.
 */

import type { SkillManagerAdapter, BackendSkill } from './types';
import type { PluginApiClient } from '@agent-type';

/**
 * Creates a SkillManagerAdapter that delegates all calls to a backend plugin
 * via a pre-bound PluginApiClient.
 *
 * The apiClient's pluginId is already bound — callers only pass method + params.
 *
 * @param apiClient  A pre-bound PluginApiClient for the 'skill' plugin.
 * @returns          A SkillManagerAdapter implementation.
 */
export function createSkillPluginAdapter(apiClient: PluginApiClient): SkillManagerAdapter {
  return {
    async listSkills(): Promise<BackendSkill[]> {
      return apiClient.call<BackendSkill[]>('listSkills');
    },

    async installSkill(input: { url?: string; name?: string; content?: string; useProxy?: boolean }): Promise<{ installed: string; message: string }> {
      return apiClient.call<{ installed: string; message: string }>('installSkill', input);
    },

    async removeSkill(name: string): Promise<{ deleted: string }> {
      return apiClient.call<{ deleted: string }>('removeSkill', { name });
    },

    async readSkillFile(skill: string, path: string): Promise<{ content: string; path: string }> {
      return apiClient.call<{ content: string; path: string }>('readSkillFile', { name: skill, path });
    },
  };
}
