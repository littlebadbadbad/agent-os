/**
 * agent-UI/slots/registry.ts — SlotRegistry
 *
 * Central registry of all plugin UI injection points.
 *
 * Populated at render time by reading session state's plugin adapters.
 * The registry is a cache — slot declarations originate from
 * `PluginUiAdapter.slots` in each ToolSet's `onGetSymbolState` return.
 *
 * Thread-safe for concurrent reads/writes (single-threaded runtime).
 */

import type {
  PluginSlotDeclaration,
  SlotType,
  PanelSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  InlinePromptSlotDeclaration,
  HeaderBarSlotDeclaration,
} from "@agent-type";

// ── Slot entry ────────────────────────────────────────────────────────────────

/** A registered slot with its owning plugin id. */
export interface SlotEntry<T extends PluginSlotDeclaration = PluginSlotDeclaration> {
  /** Plugin that owns this slot. */
  readonly pluginId: string;
  /** The slot declaration. */
  readonly declaration: T;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface SlotRegistry {
  /**
   * Register a slot for a plugin. Replaces any existing slot with the
   * same pluginId + declaration.id.
   */
  register(pluginId: string, declaration: PluginSlotDeclaration): void;

  /**
   * Remove all slots registered by a plugin.
   */
  unregister(pluginId: string): void;

  /**
   * Get all slots of a specific type across all plugins.
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
  getByType(type: SlotType): ReadonlyArray<SlotEntry<PluginSlotDeclaration>>;

  /**
   * Get all slots registered by a specific plugin.
   */
  getForPlugin(pluginId: string): readonly PluginSlotDeclaration[];

  /**
   * Get a specific slot by pluginId + slotId.
   */
  getSlot(
    pluginId: string,
    slotId: string,
  ): PluginSlotDeclaration | undefined;

  /**
   * Check if any slots are registered.
   */
  readonly isEmpty: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSlotRegistry(): SlotRegistry {
  // Map key: `${pluginId}::${declaration.id}`
  const entries = new Map<string, SlotEntry>();

  function key(pluginId: string, slotId: string): string {
    return `${pluginId}::${slotId}`;
  }

  return {
    register(pluginId: string, declaration: PluginSlotDeclaration): void {
      entries.set(key(pluginId, declaration.id), { pluginId, declaration });
    },

    unregister(pluginId: string): void {
      for (const [k, v] of entries) {
        if (v.pluginId === pluginId) entries.delete(k);
      }
    },

    getByType(type: SlotType): ReadonlyArray<SlotEntry<any>> {
      const result: SlotEntry<any>[] = [];
      for (const entry of entries.values()) {
        if (entry.declaration.type === type) {
          result.push(entry);
        }
      }
      return result;
    },

    getForPlugin(pluginId: string): readonly PluginSlotDeclaration[] {
      const result: PluginSlotDeclaration[] = [];
      for (const entry of entries.values()) {
        if (entry.pluginId === pluginId) {
          result.push(entry.declaration);
        }
      }
      return result;
    },

    getSlot(
      pluginId: string,
      slotId: string,
    ): PluginSlotDeclaration | undefined {
      return entries.get(key(pluginId, slotId))?.declaration;
    },

    get isEmpty(): boolean {
      return entries.size === 0;
    },
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/** Global slot registry instance. */
export const slotRegistry: SlotRegistry = createSlotRegistry();
