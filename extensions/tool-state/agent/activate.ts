/**
 * Tool State plugin activation entry.
 */

import type { AgentPluginHost, PluginSlotDeclaration } from '@agent-type';
import { createToolStateToolSet } from './toolSet';

const SLOTS: readonly PluginSlotDeclaration[] = [
  {
    type: 'panel',
    label: 'Tools',
    showTab: () => true,
    shouldRender: () => true,
    badge: (_ctx, state) => {
      const toolStates = state?.toolStates;
      if (!toolStates || toolStates.length === 0) return null;
      const enabled = toolStates.filter((t) => t.enabled).length;
      return enabled < toolStates.length ? `${enabled}/${toolStates.length}` : `${toolStates.length}`;
    },
  },
] satisfies readonly PluginSlotDeclaration[];

export function activate(host: AgentPluginHost): void {
  host.registerToolSet(createToolStateToolSet(), SLOTS);
}
