/**
 * agent-UI/plugin/discoverSlots.ts — Slot declaration discovery
 *
 * Collects {@link PluginSlotDeclaration}s from each plugin's standalone
 * slot registry (populated at plugin activation time via
 * `host.registerToolSet(toolSet, slots)`).
 *
 * Slots are stored independently from session state so they can be
 * discovered even without an active session — the session state is
 * only needed to provide toolset state to display callbacks.
 *
 * This is the single source of slot declarations for both the main-agent
 * slot registry and sub-agent conversation panes.
 */

import type { PluginSlotDeclaration } from "@agent-type";
import type { SlotEntry } from "../slots/registry";
import type { ActivatedPluginInfo } from "./pluginSystem";

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
 * A raw slot entry discovered from a plugin's slot registry.
 */
export interface DiscoveredSlotEntry {
  readonly pluginId: string;
  readonly toolSetSymbol: symbol;
  readonly slotIndex: number;
  readonly declaration: PluginSlotDeclaration;
}

/**
 * Collect all slot declarations from active plugins' standalone registries.
 *
 * Unlike the old state-based discovery, this function reads from the
 * `slotDeclarations` map that was populated during plugin activation.
 * No session state is required — slots are always discoverable.
 *
 * @param plugins Active plugins whose slot declarations to inspect.
 * @returns Flat list of `{ pluginId, toolSetSymbol, slotIndex, declaration }` entries.
 */
export function collectStandaloneSlots(
  plugins: readonly ActivatedPluginInfo[],
): readonly DiscoveredSlotEntry[] {
  const entries: DiscoveredSlotEntry[] = [];
  for (const plugin of plugins) {
    for (const [sym, slots] of plugin.slotDeclarations) {
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
