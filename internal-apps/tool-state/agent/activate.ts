/**
 * Tool State app activation entry.
 *
 * Registers the ToolSet with both slot types (panel + toolButton) and
 * installs the bridge methods that power the session-independent global
 * control (see bridge.ts for why the bridge — not app state — backs it).
 */

import type { AgentAppHost } from '@agent-type';
import type { ToolStateBridge } from './bridge';
import { createToolStateBridge } from './bridge';
import { globalToolStore } from './globalStore';
import { createToolStateToolSet } from './toolSet';
import { createToolStateSlots } from './slots';

export function activate(host: AgentAppHost<ToolStateBridge>): void {
  const toolSet = createToolStateToolSet(globalToolStore);
  host.registerToolSet(toolSet, createToolStateSlots(globalToolStore));
  Object.assign(host.bridge, createToolStateBridge(globalToolStore, () => toolSet.getToolPool()));
}
