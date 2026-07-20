import type { AgentPluginHost } from '@agent-type';
import { createToolSearchToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createToolSearchToolSet();
  host.registerToolSet(toolSet);
}
