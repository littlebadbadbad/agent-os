/**
 * Tool State slot declarations.
 *
 * Two slots share the same UI bundle:
 *
 *  - `panel`      — per-session Tools tab. Sees the active session's tool
 *                   state (with globally-disabled tools rendered as locked).
 *  - `toolButton` — session-independent global control in the AI control
 *                   bar. Controls the global disabled set for ALL sessions
 *                   via the bridge (see bridge.ts).
 *
 * The toolButton badge counts globally-disabled tools from the closure
 * store — the `state` argument is the ACTIVE session's symbol state and is
 * `undefined` when no session exists, so it cannot back a global badge.
 */

import type { SlotDeclaration } from '@agent-type';
import type { GlobalToolStore } from './globalStore';

export function createToolStateSlots(store: GlobalToolStore): readonly SlotDeclaration[] {
  return [
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
    {
      type: 'toolButton',
      label: 'Tools',
      icon: '\u{1F6E0}',
      containingWidth: '420px',
      containingHeight: '560px',
      showBtn: () => true,
      badge: () => {
        const count = store.size();
        return count > 0 ? `off ${count}` : null;
      },
    },
  ] satisfies readonly SlotDeclaration[];
}
