import type { AgentAppHost } from '@agent-type';
import { createVariableToolSet } from './toolSet';

export function activate(host: AgentAppHost): void {
  const toolSet = createVariableToolSet();
  host.registerToolSet(toolSet);
}
