/**
 * agent-UI/plugin/discoverSlots.ts — Shared slot discovery
 *
 * Iterates active plugins' symbol-keyed state slices and collects all
 * {@link PluginSlotDeclaration}s registered via {@link PluginUiAdapter.slots}.
 *
 * Used by both the main-agent slot registry and sub-agent conversation panes.
 * The only difference between the two callers is the output target:
 *   - `pluginSystem.refreshSlots()` → calls `slotRegistry.register()` per entry
 *   - `discoverSubAgentSlots()` → returns entries as a flat array for inline rendering
 *
 * This function lives here so both callers delegate to a single implementation.
 *
 * Why `state` is typed as `object`:
 *
 * The function only needs `Reflect.get` access on the state to read
 * symbol-keyed plugin slices. Both `AgentSessionState` and
 * `SubAgentConversationState` are objects at runtime, and `object` is
 * the most precise static type that both satisfy without type assertions.
 */

import type { PluginSlotDeclaration } from "@agent-type";
import type { SlotEntry } from "../slots/registry";
import type { ActivatedPluginInfo } from "./pluginSystem";

/**
 * Runtime check: does the value look like it has a `slots` array?
 * @returns The `slots` array, or `undefined`.
 */
function tryGetSlots(
  value: unknown,
): readonly PluginSlotDeclaration[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("slots" in value)) return undefined;
  const obj = value as { readonly slots: unknown };
  if (!Array.isArray(obj.slots)) return undefined;
  return obj.slots as readonly PluginSlotDeclaration[];
}

/**
 * Auto-generate a unique slot id from plugin + toolset symbol + index.
 */
function generateSlotId(
  pluginId: string,
  toolSetSymbol: symbol,
  slotIndex: number,
): string {
  const desc = toolSetSymbol.description ?? "toolset";
  return `${pluginId}::${desc}::${slotIndex}`;
}

/**
 * A raw slot entry discovered from state — before registration.
 */
export interface DiscoveredSlotEntry {
  readonly pluginId: string;
  readonly toolSetSymbol: symbol;
  readonly slotIndex: number;
  readonly declaration: PluginSlotDeclaration;
}

/**
 * Discover all plugin slot declarations from a session/conversation state.
 *
 * @param state   Session or conversation state snapshot.  Typed as
 *                `unknown` because the main-agent and sub-agent state
 *                types use incompatible index signatures; runtime guards
 *                handle both uniformly.
 * @param plugins Active plugins whose symbol-keyed state to inspect.
 * @returns Flat list of `{ pluginId, toolSetSymbol, slotIndex, declaration }` entries.
 */
export function discoverSlots(
  state: object,
  plugins: readonly ActivatedPluginInfo[],
): readonly DiscoveredSlotEntry[] {
  // Guard: must be a non-null object for Reflect.get to work safely.
  if (typeof state !== "object" || state === null) {
    return [];
  }

  const entries: DiscoveredSlotEntry[] = [];
  for (const plugin of plugins) {
    for (const sym of plugin.symbols) {
      const slots = tryGetSlots(Reflect.get(state, sym));
      if (slots) {
        for (let i = 0; i < slots.length; i++) {
          entries.push({
            pluginId: plugin.id,
            toolSetSymbol: sym,
            slotIndex: i,
            declaration: slots[i],
          });
        }
      }
    }
  }
  return entries;
}

/**
 * Convert discovered entries to fully-formed SlotEntry (with auto-generated slotId).
 */
export function toSlotEntries(
  discovered: readonly DiscoveredSlotEntry[],
): readonly SlotEntry[] {
  return discovered.map((e) => ({
    pluginId: e.pluginId,
    toolSetSymbol: e.toolSetSymbol,
    slotId: generateSlotId(e.pluginId, e.toolSetSymbol, e.slotIndex),
    declaration: e.declaration,
  }));
}
