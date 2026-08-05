import type { AgentPluginHost } from '@agent-type';
import { createToolResultCompressorToolSet } from './toolSet';

export function activate(host: AgentPluginHost): void {
  const toolSet = createToolResultCompressorToolSet();
  host.registerToolSet(toolSet);
}
