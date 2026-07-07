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
  | "inlinePrompt"
  | "messageInterceptor"
  | "headerBar";

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
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /** Tab label shown in the sidebar tab bar. */
  readonly label: string;
  /** Whether to show a tab for this panel. Called on every state update. */
  readonly showTab: () => boolean;
  /** Optional emoji/icon for the tab. */
  readonly icon?: string;
  /** Sort order in the tab bar (lower = first). Default 100. */
  readonly order?: number;
  /**
   * Optional badge text shown next to the tab label.
   * Return `null` to hide the badge. Called on every state update.
   */
  readonly badge?: () => string | null;
  /**
   * Preferred containing width for this slot.
   * Defaults to "100%" if omitted (fills panel container).
   */
  readonly containingWidth?: string;
  /**
   * Preferred containing height for this slot.
   * Defaults to "100%" if omitted (fills panel container).
   */
  readonly containingHeight?: string;
}

/**
 * A toolCard slot renders a tool-call result card in the chat stream.
 *
 * The host creates a sandboxed iframe and pushes
 * {@link ToolCardHostMessage} when a matching tool is invoked.
 */
export interface ToolCardSlotDeclaration {
  readonly type: "toolCard";
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /** Tool names this slot handles. */
  readonly toolNames: readonly string[];
  /**
   * Preferred containing width for this slot.
   * Defaults to "100%" if omitted.
   */
  readonly containingWidth?: string;
  /**
   * Preferred containing height for this slot.
   * Defaults to "auto" if omitted.
   */
  readonly containingHeight?: string;
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
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /** Tool names this slot handles. */
  readonly toolNames: readonly string[];
  /**
   * Preferred containing width for this slot.
   * Defaults to "auto" if omitted.
   */
  readonly containingWidth?: string;
  /**
   * Preferred containing height for this slot.
   * Defaults to "auto" if omitted.
   */
  readonly containingHeight?: string;
}

/**
 * An inlinePrompt slot renders a floating prompt overlay for user input.
 *
 * The host creates a sandboxed iframe and pushes
 * {@link InlinePromptHostMessage} on every state change.
 * The iframe reads prompt data from `host.getPluginState()`
 * and calls the plugin's responder function directly.
 *
 * The host calls `shouldRender` on every session state change. When it
 * returns `false`, the iframe is unmounted entirely — saving resources
 * when no prompts are pending. This is analogous to
 * {@link PanelSlotDeclaration.showTab}.
 */
export interface InlinePromptSlotDeclaration {
  readonly type: "inlinePrompt";
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /**
   * Whether this inline prompt slot should render.
   * Called on every session state change. Return `false` to hide the
   * iframe entirely (saves resources when no prompts are pending).
   */
  readonly shouldRender: () => boolean;
  /**
   * Preferred containing width for this slot.
   * Defaults to "100%" if omitted.
   */
  readonly containingWidth?: string;
  /**
   * Preferred containing height for this slot.
   * Defaults to "auto" if omitted.
   */
  readonly containingHeight?: string;
}

/**
 * A messageInterceptor slot lets a plugin decide how to handle user messages
 * that are sent while the agent loop is running (`isLoading === true`).
 *
 * No iframe — the host queries `shouldIntercept` on every `sendMessage` call.
 * When it returns `true`, the host calls `interceptMessage` instead of
 * `session.sendMessage`.
 *
 * This is how the pending-input plugin queues messages for the next loop
 * iteration without the host knowing about queuing logic.
 */
export interface MessageInterceptorSlotDeclaration {
  readonly type: "messageInterceptor";
  /** Unique slot identifier within the plugin (e.g. "user-input.interceptor"). */
  readonly id: string;
  /**
   * Called on every `sendMessage` attempt. Return `true` when the plugin
   * wants to handle the message itself (e.g. queue it for later), `false`
   * to let the host send it normally.
   *
   * Typically returns `true` only when `isLoading` is `true`.
   */
  readonly shouldIntercept: (isLoading: boolean) => boolean;
  /**
   * Called when `shouldIntercept` returned `true`.
   * The plugin receives the message text and handles it (e.g. queues it).
   */
  readonly interceptMessage: (text: string) => void;
}

/**
 * A headerBar slot renders a thin full-width bar above the tab bar.
 *
 * The host creates a sandboxed iframe, subscribes to session state,
 * and pushes state updates via {@link HeaderBarHostMessage}.
 */
export interface HeaderBarSlotDeclaration {
  readonly type: "headerBar";
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /** Whether this header bar should render. Called on every state update. */
  readonly shouldRender: () => boolean;
  /**
   * Preferred containing width for this slot.
   * Defaults to "100%" if omitted.
   */
  readonly containingWidth?: string;
  /**
   * Preferred containing height for this slot.
   * Defaults to the slot type's standard height if omitted.
   */
  readonly containingHeight?: string;
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
  | InlinePromptSlotDeclaration
  | MessageInterceptorSlotDeclaration
  | HeaderBarSlotDeclaration;

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
    readonly state: AgentSessionState;
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
    readonly state: AgentSessionState;
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
