import type { AgentPluginHost } from '@agent-type';
import { createPermissionsToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createPermissionsToolSet();
  host.registerToolSet(toolSet);
}
