/**
 * internal-apps/devops/agent/activate.ts — DevOps app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the devops extension is activated.
 *
 * The app receives an AgentAppHost with a pre-bound apiClient.
 * It passes `host.bridge` (the shared reference) to the ToolSet factory
 * so tools capture the same object that the UI will populate with real
 * handler implementations at slot mount time.
 *
 * @param host  The AgentAppHost for this app.
 */
import type { AgentAppHost } from '@agent-type';
import type { DevOpsBridge } from '../ui/types';
import { createDevopsAppAdapter } from './appAdapter';
import { createDevopsToolset } from './manager';

/**
 * Activate the devops app.
 */
export function activate(host: AgentAppHost<DevOpsBridge>): void {
  const adapter = createDevopsAppAdapter(host.apiClient);

  const { toolSet, slotDeclarations } = createDevopsToolset(adapter, host.bridge);

  host.registerToolSet(toolSet, slotDeclarations);
}
