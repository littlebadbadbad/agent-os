/**
 * extensions/file/agent/activate.ts — File plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { createFilePluginAdapter } from './pluginAdapter';
import { createFileToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createFilePluginAdapter(host.apiClient);
  host.registerToolSet(createFileToolSet(adapter));
}
