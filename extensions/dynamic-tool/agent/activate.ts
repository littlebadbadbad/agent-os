/**
 * extensions/dynamic-tool/agent/activate.ts — Dynamic tool plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { createDynamicToolPluginAdapter } from './pluginAdapter';
import { createDynamicToolset } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createDynamicToolPluginAdapter(host.apiClient);
  host.registerToolSet(createDynamicToolset(adapter));
}
