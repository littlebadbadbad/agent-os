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
import { pluginSystem } from "../agents";
import { discoverSlots, toSlotEntries } from "./discoverSlots";

/**
 * Create a {@link SlotSession} view over a {@link SubAgentConversation}.
 *
 * The returned object delegates `getState()` and `subscribe()` directly to
 * the conversation handle — no copying, no caching, no extra allocations.
 *
 * The conversion is type-safe without casts because:
 *   1. `SubAgentConversationState` is structurally assignable to
 *      `SessionStateLike` (has `id`, `isLoading`, `agentName`,
 *      `conversationId`, and `[key: symbol]`).
 *   2. `SlotSession.getState()` returns `SessionStateLike` — a minimal
 *      interface that captures only what slot renderers need.
 */
export function createSubAgentSlotSession(
  conv: SubAgentConversation,
): SlotSession {
  return {
    getState: () => conv.getState(),
    subscribe: (fn) => conv.subscribe(fn),
  };
}

// ── Slot discovery ────────────────────────────────────────────────────────────

/**
 * Discover all plugin slots declared in a sub-agent conversation's state.
 *
 * Mirrors {@link PluginSystem.refreshSlots} but reads from a
 * {@link SubAgentConversationState} instead of `AgentSessionState`.
 * Returns slot entries directly (does not mutate the global `slotRegistry`).
 *
 * @param convState The sub-agent conversation state to read slots from.
 * @returns Flat list of `{ pluginId, declaration }` entries for all slots
 *          found across all active plugins' symbol-keyed state slices.
 */
export function discoverSubAgentSlots(
  convState: SubAgentConversationState,
): readonly SlotEntry[] {
  // Delegate to the shared discovery helper — the traversal logic is
  // identical to pluginSystem.refreshSlots(), only the output differs.
  return toSlotEntries(discoverSlots(convState, pluginSystem.activePlugins));
}
