/**
 * agent-type/ui-slot.ts — Re-export shim
 *
 * Slot types have been split into:
 *   - agent-type/ui-slot/types.ts     — Declarations, SlotDisplayContext, SlotContext
 *   - agent-type/ui-slot/protocol.ts  — Host↔Iframe messages, FilterSlots
 *   - agent-type/ui-slot/index.ts     — Barrel re-export
 *
 * This file exists solely for backward compatibility — all imports
 * still resolve through `@agent-type` (which re-exports from ui-slot/index.ts).
 */
export type {
  SlotDisplayContext,
  SlotType,
  PanelSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  InlinePromptSlotDeclaration,
  MessageInterceptorSlotDeclaration,
  HeaderBarSlotDeclaration,
  PluginSlotDeclaration,
  SlotContext,
  PanelHostMessage,
  ToolCardHostMessage,
  CompactToolCardHostMessage,
  InlinePromptHostMessage,
  HeaderBarHostMessage,
  SlotHostMessage,
  CompactToolCardIframeMessage,
  SlotIframeMessage,
  FilterSlots,
} from "./ui-slot/index";
