/**
 * agent-type/ui-slot/protocol.ts — Host ↔ Iframe message protocols
 *
 * Three-layer architecture:
 *   1. ToolSet declares slots via `PluginUiAdapter.slots` — "what capabilities"
 *   2. Plugin UI (iframe) renders per slot via `host.getSlotContext()` — "what it looks like"
 *   3. Host renders slots via `SlotRenderer` + `SlotRegistry` — "where it goes"
 *
 * This file contains all typed message interfaces for host→iframe and
 * iframe→host communication.  Each slot type has its own host message
 * shape, collected into the `SlotHostMessage` / `SlotIframeMessage`
 * discriminated unions.
 */

import type { SessionStateLike } from "../core";
import type { ToolCallInfo } from "../plugin";
import type { PluginSlotDeclaration, SlotType } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
//  Host → Iframe message protocol (per slot type)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Host pushes full session state to a panel iframe on every change.
 *
 * The iframe re-reads `host.getPluginState()` when notified,
 * same pattern as the current Link B `stateUpdate`.
 */
export interface PanelHostMessage {
  readonly version: 1;
  readonly type: "panel";
  /** The slot being targeted. */
  readonly slotId: string;
  /** Current session state snapshot. */
  readonly payload: {
    readonly state: SessionStateLike;
  };
}

/**
 * Host pushes tool-call information to a toolCard iframe.
 */
export interface ToolCardHostMessage {
  readonly version: 1;
  readonly type: "toolCard";
  /** The slot being targeted. */
  readonly slotId: string;
  /** Tool call information to render. */
  readonly payload: {
    readonly toolCallInfo: ToolCallInfo;
  };
}

/**
 * Host pushes tool-call information to a compactToolCard iframe.
 *
 * Same payload shape as {@link ToolCardHostMessage} — the compact card
 * receives the same tool-call info but is expected to render only a
 * single-row summary, not the full detail.
 */
export interface CompactToolCardHostMessage {
  readonly version: 1;
  readonly type: "compactToolCard";
  /** The slot being targeted. */
  readonly slotId: string;
  /** Tool call information to render. */
  readonly payload: {
    readonly toolCallInfo: ToolCallInfo;
  };
}

/**
 * Host pushes state updates to an inlinePrompt iframe.
 *
 * The iframe re-reads `host.getPluginState()` when notified
 * to access the current prompt entries and responder callbacks.
 */
export interface InlinePromptHostMessage {
  readonly version: 1;
  readonly type: "inlinePrompt";
  /** The slot being targeted. */
  readonly slotId: string;
  /** Current session state snapshot. */
  readonly payload: {
    readonly state: SessionStateLike;
  };
}

/**
 * Host pushes full session state to a headerBar iframe on every change.
 *
 * Same payload shape as {@link PanelHostMessage} — the headerBar iframe
 * re-reads `host.getPluginState()` when notified.
 */
export interface HeaderBarHostMessage {
  readonly version: 1;
  readonly type: "headerBar";
  /** The slot being targeted. */
  readonly slotId: string;
  /** Current session state snapshot. */
  readonly payload: {
    readonly state: SessionStateLike;
  };
}

/**
 * Discriminated union of all host → iframe messages.
 *
 * Each branch carries `slotId` so the iframe can identify which
 * slot instance the message targets (supports multi-slot plugins).
 */
export type SlotHostMessage =
  | PanelHostMessage
  | ToolCardHostMessage
  | CompactToolCardHostMessage
  | InlinePromptHostMessage
  | HeaderBarHostMessage;

// ═══════════════════════════════════════════════════════════════════════════════
//  Iframe → Host message protocol (per slot type)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CompactToolCard iframe messages.
 *
 * - `openDetail`: the user clicked the compact card; the host should open
 *   the full detail modal (which may itself render a `toolCard` slot).
 */
export interface CompactToolCardIframeMessage {
  readonly version: 1;
  readonly type: "openDetail";
}

/**
 * Discriminated union of all iframe → host messages.
 */
export type SlotIframeMessage = CompactToolCardIframeMessage;

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers: extract slot declarations by type
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Filter {@link PluginSlotDeclaration}[] to a specific slot type.
 * Narrows the discriminated union at compile time.
 */
export type FilterSlots<
  TDeclarations extends readonly PluginSlotDeclaration[],
  TType extends SlotType,
> = Extract<TDeclarations[number], { readonly type: TType }>;
