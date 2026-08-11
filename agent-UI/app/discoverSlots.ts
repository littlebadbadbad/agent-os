/**
 * agent-UI/app/discoverSlots.ts — Slot declaration discovery
 *
 * Collects {@link SlotDeclaration}s from each app's standalone
 * slot registry (populated at app activation time via
 * `host.registerToolSet(toolSet, slots)`).
 *
 * Slots are stored independently from session state so they can be
 * discovered even without an active session — the session state is
 * only needed to provide toolset state to display callbacks.
 *
 * This is the single source of slot declarations for both the main-agent
 * slot registry and sub-agent conversation panes.
 */

import type { SlotDeclaration } from "@agent-type";
import type { SlotEntry } from "../slots/registry";
import type { ActivatedAppInfo } from "./appSystem";

/**
 * Auto-generate a unique slot id from app + toolset symbol + index.
 */
function generateSlotId(
  appId: string,
  toolSetSymbol: symbol,
  slotIndex: number,
): string {
  const desc = toolSetSymbol.description ?? "toolset";
  return `${appId}::${desc}::${slotIndex}`;
}

/**
 * A raw slot entry discovered from a app's slot registry.
 */
export interface DiscoveredSlotEntry {
  readonly appId: string;
  readonly toolSetSymbol: symbol;
  readonly slotIndex: number;
  readonly declaration: SlotDeclaration;
}

/**
 * Collect all slot declarations from active apps' standalone registries.
 *
 * Unlike the old state-based discovery, this function reads from the
 * `slotDeclarations` map that was populated during app activation.
 * No session state is required — slots are always discoverable.
 *
 * @param apps Active apps whose slot declarations to inspect.
 * @returns Flat list of `{ appId, toolSetSymbol, slotIndex, declaration }` entries.
 */
export function collectStandaloneSlots(
  apps: readonly ActivatedAppInfo[],
): readonly DiscoveredSlotEntry[] {
  const entries: DiscoveredSlotEntry[] = [];
  for (const app of apps) {
    for (const [sym, slots] of app.slotDeclarations) {
      for (let i = 0; i < slots.length; i++) {
        entries.push({
          appId: app.id,
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
    appId: e.appId,
    toolSetSymbol: e.toolSetSymbol,
    slotId: generateSlotId(e.appId, e.toolSetSymbol, e.slotIndex),
    declaration: e.declaration,
  }));
}
