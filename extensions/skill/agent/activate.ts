/**
 * extensions/skill/agent/activate.ts — Skill plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the skill extension is activated.
 *
 * The plugin receives an AgentPluginHost with a pre-bound apiClient
 * (no pluginId parameter needed) and registers its ToolSet.
 */

import type { AgentPluginHost } from '@agent-type';
import { createSkillPluginAdapter } from './pluginAdapter';
import { createSkillToolset } from './manager';

/**
 * Activate the skill plugin.
 *
 * Creates a plugin adapter backed by the pre-bound apiClient, builds
 * the skill ToolSet, and registers it on the agent.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  const adapter = createSkillPluginAdapter(host.apiClient);

  const { toolSet, slotDeclarations, agentApis } = createSkillToolset(adapter);

  host.registerToolSet(toolSet, slotDeclarations);
  for (const [method, handler] of agentApis) {
    host.registerAgentApi(method, handler);
  }
}
