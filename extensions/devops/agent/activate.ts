/**
 * extensions/devops/agent/activate.ts — DevOps plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the devops extension is activated.
 *
 * The plugin receives an AgentPluginHost with a pre-bound apiClient.
 * It passes `host.bridge` (the shared reference) to the ToolSet factory
 * so tools capture the same object that the UI will populate with real
 * handler implementations at slot mount time.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
import type { AgentPluginHost } from '@agent-type';
import type { DevOpsBridge } from '../ui/types';
import { createDevopsPluginAdapter } from './pluginAdapter';
import { createDevopsToolset } from './manager';

/**
 * Activate the devops plugin.
 */
export function activate(host: AgentPluginHost<DevOpsBridge>): void {
  const adapter = createDevopsPluginAdapter(host.apiClient);

  const { toolSet, slotDeclarations } = createDevopsToolset(adapter, host.bridge);

  host.registerToolSet(toolSet, slotDeclarations);
}
