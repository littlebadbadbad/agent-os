/**
 * agent-UI/app/subAgentSlotSession.ts
 *
 * Adapts a {@link SubAgentConversation} to the {@link SlotSession} interface
 * so that slot renderers (HeaderBarSlotRenderer, PanelSlotRenderer, etc.)
 * can render app slots inside sub-agent conversation panes.
 *
 * ## Why this adapter is needed
 *
 * `SlotSession.getState()` returns `AgentSessionState`, which extends
 * `Record<string, unknown>` (via `AgentSessionExtension`).  `SubAgentConversationState`
 * has the same structural shape (`id`, `isLoading`, `[key: symbol]` index) but
 * does not declare a string index signature, so TypeScript does not consider
 * it directly assignable.
 *
 * At runtime the two types are compatible — slot renderers only read
 * `state[symbol]` for app state slices and push the whole object to the
 * iframe via `host._pushToIframe`.  This adapter performs the type-level
 * bridge without any runtime transformation.
 */

import type { SlotSession, SlotDeclaration } from "@agent-type";
import type { SubAgentConversation, SubAgentConversationState } from "@agent-sdk";
import type { SlotEntry } from "../slots/registry";
import { collectStandaloneSlots, toSlotEntries } from "./discoverSlots";
import { ActivatedAppInfo } from "./appTypes";

export function createSubAgentSlotSession(
  conv: SubAgentConversation,
): SlotSession {
  return {
    getState: () => conv.getState(),
    subscribe: (fn) => conv.subscribe(fn),
  };
}

export function discoverSubAgentSlots(
  _convState: SubAgentConversationState,
  activeApps: readonly ActivatedAppInfo[],
): readonly SlotEntry[] {
  return toSlotEntries(collectStandaloneSlots(activeApps));
}
