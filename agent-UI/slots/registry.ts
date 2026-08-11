/**
 * agent-UI/slots/registry.ts — SlotRegistry
 *
 * Central registry of all app UI injection points.
 *
 * Populated at render time from standalone slot declarations registered
 * via `host.registerToolSet(toolSet, slots)` at app activation time.
 * Slots are stored independently from session state so they can be
 * discovered even without an active session.
 *
 * Thread-safe for concurrent reads/writes (single-threaded runtime).
 */

import type {
  AppSlotDeclaration,
  SlotDeclaration,
  SlotType,
  PanelSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  InlinePromptSlotDeclaration,
  HeaderBarSlotDeclaration,
  ToolButtonSlotDeclaration,
  AutocompleteSlotDeclaration,
} from "@agent-type";

// ── Slot entry ────────────────────────────────────────────────────────────────

/** A registered slot with its owning app id, toolset symbol, and auto-generated slot id. */
export interface SlotEntry<T extends SlotDeclaration = SlotDeclaration> {
  /** App that owns this slot. */
  readonly appId: string;
  /** The ToolSet's symbol that declared this slot. */
  readonly toolSetSymbol: symbol;
  /** Auto-generated unique slot identifier: `"${appId}::${symbolDesc}::${slotIndex}"`. */
  readonly slotId: string;
  /** The slot declaration (no `id` — the host assigns `slotId`). */
  readonly declaration: T;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface SlotRegistry {
  /**
   * Get all slots of a specific type across all apps.
   *
   * Overloads ensure callers get precisely narrowed return types:
   * `SlotEntry<PanelSlotDeclaration>` when passing `"panel"`,
   * `SlotEntry<ToolCardSlotDeclaration>` for `"toolCard"`, etc.
   */
  getByType(type: "panel"): ReadonlyArray<SlotEntry<PanelSlotDeclaration>>;
  getByType(type: "toolCard"): ReadonlyArray<SlotEntry<ToolCardSlotDeclaration>>;
  getByType(type: "compactToolCard"): ReadonlyArray<SlotEntry<CompactToolCardSlotDeclaration>>;
  getByType(type: "inlinePrompt"): ReadonlyArray<SlotEntry<InlinePromptSlotDeclaration>>;
  getByType(type: "headerBar"): ReadonlyArray<SlotEntry<HeaderBarSlotDeclaration>>;
  getByType(type: "toolButton"): ReadonlyArray<SlotEntry<ToolButtonSlotDeclaration>>;
  getByType(type: "app"): ReadonlyArray<SlotEntry<SlotDeclaration>>;
  getByType(type: "autocomplete"): ReadonlyArray<SlotEntry<AutocompleteSlotDeclaration>>;
  getByType(type: SlotType): ReadonlyArray<SlotEntry<SlotDeclaration>>;

  /**
   * Get all slots registered by a specific app.
   */
  getForApp(appId: string): readonly SlotDeclaration[];

  /**
   * Get a specific slot by appId + slotId.
   * Returns the full SlotEntry with toolSetSymbol, or undefined.
   */
  getSlot(
    appId: string,
    slotId: string,
  ): SlotEntry | undefined;

  /**
   * Check if any slots are registered.
   */
  readonly isEmpty: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSlotRegistry(slotEntries?: readonly SlotEntry[]): SlotRegistry {
  // Map key: `${appId}::${slotId}`
  const entries = new Map<string, SlotEntry>();

  function key(appId: string, slotId: string): string {
    return `${appId}::${slotId}`;
  }

  // Pre-populate from initial entries (if provided).
  if (slotEntries) {
    for (const entry of slotEntries) {
      entries.set(key(entry.appId, entry.slotId), entry);
    }
  }

  return {
    getByType(type: SlotType) {
      const result: SlotEntry<SlotDeclaration>[] = [];
      for (const entry of entries.values()) {
        if (entry.declaration.type === type) {
          result.push(entry);
        }
      }
      return result;
    },

    getForApp(appId: string): readonly SlotDeclaration[] {
      const result: AppSlotDeclaration[] = [];
      for (const entry of entries.values()) {
        if (entry.appId === appId) {
          result.push(entry.declaration);
        }
      }
      return result;
    },

    getSlot(appId: string, slotId: string): SlotEntry | undefined {
      return entries.get(key(appId, slotId));
    },

    get isEmpty(): boolean {
      return entries.size === 0;
    },
  } as SlotRegistry;
}
