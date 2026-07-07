/**
 * extensions/todo/agent/activate.ts — Todo plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the todo extension is activated.
 *
 * The plugin receives an AgentPluginHost and registers its ToolSet.
 */

import type { AgentPluginHost } from '@agent-type';
import { createTodoTools } from './toolSet';

/**
 * Activate the todo plugin.
 *
 * Builds the todo ToolSet and registers it on the agent.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  const toolSet = createTodoTools();
  host.registerToolSet(toolSet);
}
