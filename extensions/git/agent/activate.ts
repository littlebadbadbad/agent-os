/**
 * extensions/git/agent/activate.ts — Git plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { createGitPluginAdapter } from './pluginAdapter';
import { createGitToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const adapter = createGitPluginAdapter(host.apiClient);
  host.registerToolSet(createGitToolSet(adapter));
}
