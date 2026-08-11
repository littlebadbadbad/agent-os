import type { AgentAppHost } from '@agent-type';
import { createPermissionsToolSet } from './toolSet';

export function activate(host: AgentAppHost): void {
  const toolSet = createPermissionsToolSet();
  host.registerToolSet(toolSet);
}
