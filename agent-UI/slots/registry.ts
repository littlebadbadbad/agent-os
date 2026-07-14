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
  ToolButtonSlotDeclaration,
  AutocompleteSlotDeclaration,
} from "@agent-type";

// ── Slot entry ────────────────────────────────────────────────────────────────

/** A registered slot with its owning plugin id, toolset symbol, and auto-generated slot id. */
export interface SlotEntry<T extends PluginSlotDeclaration = PluginSlotDeclaration> {
  /** Plugin that owns this slot. */
  readonly pluginId: string;
  /** The ToolSet's symbol that declared this slot. */
  readonly toolSetSymbol: symbol;
  /** Auto-generated unique slot identifier: `"${pluginId}::${symbolDesc}::${slotIndex}"`. */
  readonly slotId: string;
  /** The slot declaration (no `id` — the host assigns `slotId`). */
  readonly declaration: T;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface SlotRegistry {
  /**
   * Register a slot for a plugin's toolset.
   *
   * @param pluginId       Plugin that owns this slot.
   * @param toolSetSymbol  The ToolSet symbol that declared this slot.
   * @param slotIndex      Zero-based index of this slot within the ToolSet's `slots` array.
   * @param declaration    The slot declaration.
   */
  register(
    pluginId: string,
    toolSetSymbol: symbol,
    slotIndex: number,
    declaration: PluginSlotDeclaration,
  ): void;

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
  getByType(type: "toolButton"): ReadonlyArray<SlotEntry<ToolButtonSlotDeclaration>>;
  getByType(type: "autocomplete"): ReadonlyArray<SlotEntry<AutocompleteSlotDeclaration>>;
  getByType(type: SlotType): ReadonlyArray<SlotEntry<PluginSlotDeclaration>>;

  /**
   * Get all slots registered by a specific plugin.
   */
  getForPlugin(pluginId: string): readonly PluginSlotDeclaration[];

  /**
   * Get a specific slot by pluginId + slotId.
   * Returns the full SlotEntry with toolSetSymbol, or undefined.
   */
  getSlot(
    pluginId: string,
    slotId: string,
  ): SlotEntry | undefined;

  /**
   * Check if any slots are registered.
   */
  readonly isEmpty: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Auto-generate a unique slot id from plugin + toolset symbol + index.
 *
 * Examples:
 *   `user-input::requestUserInput::0`
 *   `browser::browser::2`
 */
function generateSlotId(pluginId: string, toolSetSymbol: symbol, slotIndex: number): string {
  const desc = toolSetSymbol.description ?? 'toolset';
  return `${pluginId}::${desc}::${slotIndex}`;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSlotRegistry(): SlotRegistry {
  // Map key: `${pluginId}::${slotId}`
  const entries = new Map<string, SlotEntry>();

  function key(pluginId: string, slotId: string): string {
    return `${pluginId}::${slotId}`;
  }

  return {
    register(
      pluginId: string,
      toolSetSymbol: symbol,
      slotIndex: number,
      declaration: PluginSlotDeclaration,
    ): void {
      const slotId = generateSlotId(pluginId, toolSetSymbol, slotIndex);
      entries.set(key(pluginId, slotId), { pluginId, toolSetSymbol, slotId, declaration });
    },

    unregister(pluginId: string): void {
      for (const [k, v] of entries) {
        if (v.pluginId === pluginId) entries.delete(k);
      }
    },

    getByType(type: SlotType) {
      const result: SlotEntry<PluginSlotDeclaration>[] = [];
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

    getSlot(pluginId: string, slotId: string): SlotEntry | undefined {
      return entries.get(key(pluginId, slotId));
    },

    get isEmpty(): boolean {
      return entries.size === 0;
    },
  } as SlotRegistry;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/** Global slot registry instance. */
export const slotRegistry: SlotRegistry = createSlotRegistry();
