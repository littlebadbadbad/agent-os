/**
 * agent-type/ui-slot/index.ts — Slot-based plugin UI injection point types
 *
 * Three-layer architecture:
 *   1. ToolSet registers slots via `host.registerToolSet(toolSet, slots)` — "what capabilities"
 *   2. Plugin UI (iframe) renders per slot via `host.getSlotContext()` — "what it looks like"
 *   3. Host renders slots via `SlotRenderer` + `SlotRegistry` — "where it goes"
 *
 * Analogous to VS Code's `contributes.views` / `WebviewView` pattern.
 * Each slot is an independent iframe instance with typed message protocols.
 *
 * File structure:
 *   - `types.ts`      — Slot declarations, SlotDisplayContext, SlotContext
 *   - `protocol.ts`   — Host↔Iframe message types, FilterSlots helper
 *   - `index.ts`      — Barrel re-export (this file)
 */

export type {
  // ── Routing context ──
  SlotDisplayContext,
  // ── Slot discriminant ──
  SlotType,
  InlineSlotType,
  IframeSlotType,
  // ── Iframe shared config ──
  IframeConfig,
  // ── Slot declarations ──
  PanelSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  InlinePromptSlotDeclaration,
  HeaderBarSlotDeclaration,
  ToolButtonSlotDeclaration,
  AutocompleteSlotDeclaration,
  AutocompleteItem,
  CompactToolCardDescriptor,
  // ── Category-level unions ──
  InlineSlotDeclaration,
  IframeSlotDeclaration,
  PluginSlotDeclaration,
  // ── Iframe context ──
  SlotContext,
} from "./types";

export type {
  // ── Host → Iframe messages ──
  PanelHostMessage,
  ToolCardHostMessage,
  InlinePromptHostMessage,
  HeaderBarHostMessage,
  ToolButtonHostMessage,
  SlotHostMessage,
  // ── Helpers ──
  FilterSlots,
} from "./protocol";
