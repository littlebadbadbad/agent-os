/**
 * agent-type/ui-slot/protocol.ts — Host → Iframe message protocols
 *
 * Three-layer architecture:
 *   1. ToolSet registers slots via `host.registerToolSet(toolSet, slots)` — "what capabilities"
 *   2. App UI (iframe) renders per slot via `host.getSlotContext()` — "what it looks like"
 *   3. Host renders slots via `SlotRenderer` + `SlotRegistry` — "where it goes"
 *
 * This file contains typed message interfaces for host→iframe communication.
 * Each slot type has its own host message shape, collected into the
 * `SlotHostMessage` discriminated union.
 */

import type { SessionStateLike } from "../core";
import type { ToolCallInfo } from "../app";
import type { AppSlotDeclaration, SlotDeclaration, SlotType } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
//  Host → Iframe message protocol (per slot type)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Host pushes full session state to a panel iframe on every change.
 *
 * The iframe re-reads `host.getAppState()` when notified,
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
 * Host pushes state updates to an inlinePrompt iframe.
 *
 * The iframe re-reads `host.getAppState()` when notified
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
 * re-reads `host.getAppState()` when notified.
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

// ═══════════════════════════════════════════════════════════════════════════════
//  ToolButton — DropdownPanel iframe state
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Host pushes full session state to a toolButton iframe on every change.
 *
 * Same payload shape as {@link PanelHostMessage} — the toolButton iframe
 * re-reads `host.getAppState()` when notified, but uses a separate
 * message type so the iframe can distinguish dropdown-panel rendering
 * from sidebar-panel rendering.
 */
export interface ToolButtonHostMessage {
  readonly version: 1;
  readonly type: "toolButton";
  /** The slot being targeted. */
  readonly slotId: string;
  /** Current session state snapshot. */
  readonly payload: {
    readonly state: SessionStateLike;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  App — floating window iframe state
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Host pushes full session state to an app iframe on every change.
 *
 * Same payload shape as {@link PanelHostMessage} — the app iframe
 * re-reads `host.getAppState()` when notified.
 */
export interface AppHostMessage {
  readonly version: 1;
  readonly type: "app";
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
 * slot instance the message targets (supports multi-slot apps).
 */
export type SlotHostMessage =
  | PanelHostMessage
  | ToolCardHostMessage
  | InlinePromptHostMessage
  | HeaderBarHostMessage
  | ToolButtonHostMessage
  | AppHostMessage;

// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers: extract slot declarations by type
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Filter {@link AppSlotDeclaration}[] to a specific slot type.
 * Narrows the discriminated union at compile time.
 */
export type FilterSlots<
  TDeclarations extends readonly SlotDeclaration[],
  TType extends SlotType,
> = Extract<TDeclarations[number], { readonly type: TType }>;
