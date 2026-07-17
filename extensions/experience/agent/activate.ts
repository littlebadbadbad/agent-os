/**
 * extensions/experience/agent/activate.ts — Experience plugin activation entry
 *
 * Loaded by the plugin runtime when the experience extension is activated.
 * Registers the experience ToolSet on the agent.
 */

import type { AgentPluginHost } from '@agent-type';
import { createExperienceToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createExperienceToolSet();
  host.registerToolSet(toolSet);
}
