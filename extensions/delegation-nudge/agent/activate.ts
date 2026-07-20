import type { AgentPluginHost } from '@agent-type';
import { createDelegationNudgeToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createDelegationNudgeToolSet();
  host.registerToolSet(toolSet);
}
