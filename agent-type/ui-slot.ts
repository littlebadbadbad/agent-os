/**
 * agent-type/ui-slot.ts — Slot-based plugin UI injection point types
 *
 * Three-layer architecture:
 *   1. ToolSet declares slots via `PluginUiAdapter.slots` — "what capabilities"
 *   2. Plugin UI (iframe) renders per slot via `host.getSlotContext()` — "what it looks like"
 *   3. Host renders slots via `SlotRenderer` + `SlotRegistry` — "where it goes"
 *
 * Analogous to VS Code's `contributes.views` / `WebviewView` pattern.
 * Each slot is an independent iframe instance with typed message protocols.
 */

import type { AgentSessionState } from "./core";
import type { ToolCallInfo } from "./plugin";

// ═══════════════════════════════════════════════════════════════════════════════
//  Slot type discriminant
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Discriminant for all plugin UI injection points.
 * Add new values here when introducing new slot types.
 */
export type SlotType =
  | "panel"
  | "toolCard"
  | "compactToolCard"
  | "toolbarButton"
  | "statusBar";

// ═══════════════════════════════════════════════════════════════════════════════
//  Slot declarations (ToolSet → host: "I support these injection points")
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A panel slot renders a full tabbed panel in the sidebar.
 *
 * The host creates a sandboxed iframe, subscribes to session state,
 * and pushes state updates via {@link PanelHostMessage}.
 */
export interface PanelSlotDeclaration {
  readonly type: "panel";
  /** Unique slot identifier within the plugin (e.g. "browser.main"). */
  readonly id: string;
  /** Tab label shown in the sidebar tab bar. */
  readonly label: string;
  /** Whether to show a tab for this panel. Called on every state update. */
  readonly showTab: () => boolean;
  /** Optional emoji/icon for the tab. */
  readonly icon?: string;
  /** Sort order in the tab bar (lower = first). Default 100. */
  readonly order?: number;
}

/**
 * A toolCard slot renders a tool-call result card in the chat stream.
 *
 * The host creates a sandboxed iframe and pushes
 * {@link ToolCardHostMessage} when a matching tool is invoked.
 */
export interface ToolCardSlotDeclaration {
  readonly type: "toolCard";
  /** Unique slot identifier within the plugin (e.g. "browser.toolCard"). */
  readonly id: string;
  /** Tool names this slot handles (e.g. ["browser_launch", "browser_navigate"]). */
  readonly toolNames: readonly string[];
}

/**
 * A compactToolCard slot renders the single-row pill representation of a
 * tool call — the collapsed form shown in the chat stream before the user
 * clicks to open the full detail modal.
 *
 * The host creates a sandboxed iframe and pushes
 * {@link CompactToolCardHostMessage} when a matching tool is invoked.
 * When the user clicks the compact card, the iframe sends
 * {@link CompactToolCardIframeMessage} with `type: "openDetail"` so the
 * host can open the detail modal (which may itself use a `toolCard` slot).
 */
export interface CompactToolCardSlotDeclaration {
  readonly type: "compactToolCard";
  /** Unique slot identifier within the plugin (e.g. "browser.compactToolCard"). */
  readonly id: string;
  /** Tool names this slot handles (e.g. ["browser_launch", "browser_navigate"]). */
  readonly toolNames: readonly string[];
}

/**
 * A toolbarButton slot renders an inline button in the AI control bar.
 *
 * No iframe — the host renders a native button. Click dispatches
 * to the plugin via {@link ToolbarButtonIframeMessage}.
 */
export interface ToolbarButtonSlotDeclaration {
  readonly type: "toolbarButton";
  /** Unique slot identifier within the plugin (e.g. "browser.refresh"). */
  readonly id: string;
  /** Emoji or text icon for the button. */
  readonly icon: string;
  /** Tooltip shown on hover. */
  readonly tooltip?: string;
  /** Whether the button is enabled. */
  readonly enabled?: () => boolean;
}

/**
 * A statusBar slot renders persistent text in the sidebar footer.
 *
 * No iframe — the host renders inline text. Plugin pushes updates
 * via {@link StatusBarIframeMessage}.
 */
export interface StatusBarSlotDeclaration {
  readonly type: "statusBar";
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /** Initial text to display. */
  readonly text: string;
  /** Alignment: "left" or "right". */
  readonly alignment: "left" | "right";
}

/**
 * Discriminated union of all slot declarations.
 *
 * A plugin's ToolSet returns this array via `PluginUiAdapter.slots`.
 */
export type PluginSlotDeclaration =
  | PanelSlotDeclaration
  | ToolCardSlotDeclaration
  | CompactToolCardSlotDeclaration
  | ToolbarButtonSlotDeclaration
  | StatusBarSlotDeclaration;

// ═══════════════════════════════════════════════════════════════════════════════
//  Slot context (iframe reads this to know which slot it's rendering)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context injected into the iframe so the plugin UI knows:
 *   - which slot it's rendering (`slotId`)
 *   - what kind of UI to show (`slotType`)
 *
 * Plugins use this for conditional rendering:
 *   slotType === "panel" && slotId === "browser.main" → <BrowserPanel />
 *   slotType === "toolCard" → <BrowserToolCard />
 */
export interface SlotContext {
  /** The slot's unique id, matching {@link PluginSlotDeclaration.id}. */
  readonly slotId: string;
  /** The type of slot being rendered. */
  readonly slotType: SlotType;
}

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
    readonly state: AgentSessionState;
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
 * Host pushes enabled/disabled state to a toolbarButton.
 */
export interface ToolbarButtonHostMessage {
  readonly version: 1;
  readonly type: "toolbarButton";
  /** The slot being targeted. */
  readonly slotId: string;
  readonly payload: {
    readonly enabled: boolean;
  };
}

/**
 * Host pushes text content to a statusBar slot.
 */
export interface StatusBarHostMessage {
  readonly version: 1;
  readonly type: "statusBar";
  /** The slot being targeted. */
  readonly slotId: string;
  readonly payload: {
    readonly text: string;
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
  | ToolbarButtonHostMessage
  | StatusBarHostMessage;

// ═══════════════════════════════════════════════════════════════════════════════
//  Iframe → Host message protocol (per slot type)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Panel iframe reports size changes so the host can adjust the container.
 */
export interface PanelIframeMessage {
  readonly version: 1;
  readonly type: "resize";
  readonly payload: {
    readonly width: number;
    readonly height: number;
  };
}

/**
 * ToolCard iframe reports size changes.
 */
export interface ToolCardIframeMessage {
  readonly version: 1;
  readonly type: "resize";
  readonly payload: {
    readonly width: number;
    readonly height: number;
  };
}

/**
 * CompactToolCard iframe messages.
 *
 * - `resize`: same size-reporting as other slot types.
 * - `openDetail`: the user clicked the compact card; the host should open
 *   the full detail modal (which may itself render a `toolCard` slot).
 */
export interface CompactToolCardIframeMessage {
  readonly version: 1;
  readonly type: "resize" | "openDetail";
  readonly payload?: {
    readonly width?: number;
    readonly height?: number;
  };
}

/**
 * Toolbar button click dispatched from host to plugin.
 * (The host renders the button, click sends this message to the plugin.)
 */
export interface ToolbarButtonIframeMessage {
  readonly version: 1;
  readonly type: "click";
}

/**
 * StatusBar pushes updated text to the host.
 */
export interface StatusBarIframeMessage {
  readonly version: 1;
  readonly type: "update";
  readonly payload: {
    readonly text: string;
  };
}

/**
 * Discriminated union of all iframe → host messages.
 */
export type SlotIframeMessage =
  | PanelIframeMessage
  | ToolCardIframeMessage
  | CompactToolCardIframeMessage
  | ToolbarButtonIframeMessage
  | StatusBarIframeMessage;

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
