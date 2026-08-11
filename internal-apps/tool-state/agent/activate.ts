/**
 * Tool State app activation entry.
 */

import type { AgentAppHost, SlotDeclaration } from '@agent-type';
import { createToolStateToolSet } from './toolSet';

const SLOTS: readonly SlotDeclaration[] = [
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
] satisfies readonly SlotDeclaration[];

export function activate(host: AgentAppHost): void {
  host.registerToolSet(createToolStateToolSet(), SLOTS);
}
