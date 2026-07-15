/**
 * agent-UI/plugin/subAgentSlotSession.ts
 *
 * Adapts a {@link SubAgentConversation} to the {@link SlotSession} interface
 * so that slot renderers (HeaderBarSlotRenderer, PanelSlotRenderer, etc.)
 * can render plugin slots inside sub-agent conversation panes.
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
 * `state[symbol]` for plugin state slices and push the whole object to the
 * iframe via `host._pushToIframe`.  This adapter performs the type-level
 * bridge without any runtime transformation.
 */

import type { SlotSession, PluginSlotDeclaration } from "@agent-type";
import type { SubAgentConversation, SubAgentConversationState } from "@agent-sdk";
import type { SlotEntry } from "../slots/registry";
import type { ActivatedPluginInfo } from "./pluginSystem";
import { discoverSlots, toSlotEntries } from "./discoverSlots";

export function createSubAgentSlotSession(
  conv: SubAgentConversation,
): SlotSession {
  return {
    getState: () => conv.getState(),
    subscribe: (fn) => conv.subscribe(fn),
  };
}

export function discoverSubAgentSlots(
  convState: SubAgentConversationState,
  activePlugins: readonly ActivatedPluginInfo[],
): readonly SlotEntry[] {
  return toSlotEntries(discoverSlots(convState, activePlugins));
}
