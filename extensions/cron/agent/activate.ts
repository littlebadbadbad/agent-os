/**
 * extensions/cron/agent/activate.ts — Cron plugin activation entry
 *
 * Loaded by the plugin runtime when the cron extension is activated.
 * Creates a backend adapter via apiClient, builds the cron ToolSet,
 * and registers it on the agent.
 *
 * @param host  The AgentPluginHost for this plugin.
 */

import type { AgentPluginHost } from '@agent-type';
import { createCronPluginAdapter } from './pluginAdapter';
import { createCronToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createCronPluginAdapter(host.apiClient);
  const toolSet = createCronToolSet(adapter);
  host.registerToolSet(toolSet);
}
