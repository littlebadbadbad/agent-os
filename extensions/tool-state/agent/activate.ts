/**
 * extensions/tool-state/agent/activate.ts — Tool State plugin activation entry
 */

import type { AgentPluginHost } from '@agent-type';
import { createToolStateToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createToolStateToolSet();
  host.registerToolSet(toolSet);
}
