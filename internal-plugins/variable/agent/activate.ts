import type { AgentPluginHost } from '@agent-type';
import { createVariableToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createVariableToolSet();
  host.registerToolSet(toolSet);
}
