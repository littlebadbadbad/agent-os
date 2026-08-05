import type { AgentPluginHost } from '@agent-type';
import { createMemoryGraphToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createMemoryGraphToolSet();
  host.registerToolSet(toolSet);
}
