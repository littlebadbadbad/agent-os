/**
 * internal-plugins/skill/agent/activate.ts — Skill plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the skill extension is activated.
 *
 * The plugin receives an AgentPluginHost with a pre-bound apiClient
 * (no pluginId parameter needed) and registers its ToolSet.
 */

import type { AgentPluginHost } from '@agent-type';
import type { SkillBridge } from './types';
import { createSkillPluginAdapter } from './pluginAdapter';
import { createSkillToolset } from './manager';

/**
 * Activate the skill plugin.
 *
 * Creates a plugin adapter backed by the pre-bound apiClient, builds
 * the skill ToolSet, registers it, and populates the bridge so the UI
 * can call ToolSet operations directly.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost<SkillBridge>): void {
  const adapter = createSkillPluginAdapter(host.apiClient);

  const { toolSet, slotDeclarations, bridgeMethods } = createSkillToolset(adapter);

  host.registerToolSet(toolSet, slotDeclarations);
  Object.assign(host.bridge, bridgeMethods);
}
