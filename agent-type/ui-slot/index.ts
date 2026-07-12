/**
 * agent-type/ui-slot/index.ts — Slot-based plugin UI injection point types
 *
 * Three-layer architecture:
 *   1. ToolSet declares slots via `PluginUiAdapter.slots` — "what capabilities"
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
  // ── Slot declarations ──
  BaseSlotDeclaration,
  PanelSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  InlinePromptSlotDeclaration,
  HeaderBarSlotDeclaration,
  PluginSlotDeclaration,
  // ── Plugin UI adapter bridge ──
  PluginUiAdapter,
  // ── Iframe context ──
  SlotContext,
} from "./types";

export type {
  // ── Host → Iframe messages ──
  PanelHostMessage,
  ToolCardHostMessage,
  CompactToolCardHostMessage,
  InlinePromptHostMessage,
  HeaderBarHostMessage,
  SlotHostMessage,
  // ── Iframe → Host messages ──
  CompactToolCardIframeMessage,
  SlotIframeMessage,
  // ── Helpers ──
  FilterSlots,
} from "./protocol";
