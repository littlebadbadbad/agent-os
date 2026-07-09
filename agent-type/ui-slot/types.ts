/**
 * agent-type/ui-slot/types.ts — Slot declaration types
 *
 * Three-layer architecture:
 *   1. ToolSet declares slots via `PluginUiAdapter.slots` — "what capabilities"
 *   2. Plugin UI (iframe) renders per slot via `host.getSlotContext()` — "what it looks like"
 *   3. Host renders slots via `SlotRenderer` + `SlotRegistry` — "where it goes"
 *
 * This file contains all slot declaration interfaces, the routing context
 * passed to display-control functions, and the SlotContext injected into iframes.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  Slot display context — passed to visibility / badge / render decision fns
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Routing context passed to slot display-control functions.
 *
 * Plugins use this to decide whether to show a tab, render a header bar,
 * or display a badge for a specific agent (main vs sub-agent).
 *
 * Example — browser plugin: the global browser session is only useful on
 * the main agent's tab, so `showTab: (ctx) => ctx.agentName === 'main'`.
 */
export interface SlotDisplayContext {
  /** The owning session id (identical for main agent and its sub-agents). */
  readonly sessionId: string;
  /** The agent name — `"main"` for the primary agent, sub-agent name otherwise. */
  readonly agentName: string;
  /** The conversation id — `"main"` for the primary conversation, unique per sub-agent conversation. */
  readonly conversationId: string;
}

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
  | "headerBar";

// ═══════════════════════════════════════════════════════════════════════════════
//  Base slot declaration — common fields shared by all slot types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base interface that all slot declarations extend.
 *
 * Every declaration carries:
 *   - `type` — discriminant for the slot kind
 *   - `id` — unique slot identifier within the plugin
 *   - `shouldRender` (optional) — render-gating callback
 *   - `containingWidth` / `containingHeight` (optional) — iframe sizing hints
 */
export interface BaseSlotDeclaration {
  readonly type: SlotType;
  /** Unique slot identifier within the plugin. */
  readonly id: string;
  /**
   * Whether this slot should render.
   * Called on every session state change. Return `false` to hide the iframe.
   * When undefined, the slot always renders.
   * Receives routing context so plugins can filter by agent.
   */
  readonly shouldRender?: (ctx: SlotDisplayContext) => boolean;
  /**
   * Preferred containing width for this slot.
   * Defaults vary by slot type (see each declaration's doc).
   */
  readonly containingWidth?: string;
  /**
   * Preferred containing height for this slot.
   * Defaults vary by slot type (see each declaration's doc).
   */
  readonly containingHeight?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Slot declarations (ToolSet → host: "I support these injection points")
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A panel slot renders a full tabbed panel in the sidebar.
 *
 * The host creates a sandboxed iframe, subscribes to session state,
 * and pushes state updates via {@link PanelHostMessage}.
 */
export interface PanelSlotDeclaration extends BaseSlotDeclaration {
  readonly type: "panel";
  /** Tab label shown in the sidebar tab bar. */
  readonly label: string;
  /** Whether to show a tab for this panel. Called on every state update.
   *  Receives routing context so plugins can differentiate main vs sub-agent. */
  readonly showTab: (ctx: SlotDisplayContext) => boolean;
  /** Optional emoji/icon for the tab. */
  readonly icon?: string;
  /** Sort order in the tab bar (lower = first). Default 100. */
  readonly order?: number;
  /**
   * Optional badge text shown next to the tab label.
   * Return `null` to hide the badge. Called on every state update.
   * Receives routing context for agent-scoped badge logic.
   */
  readonly badge?: (ctx: SlotDisplayContext) => string | null;
}

/**
 * A toolCard slot renders a tool-call result card in the chat stream.
 *
 * The host creates a sandboxed iframe and pushes
 * {@link ToolCardHostMessage} when a matching tool is invoked.
 */
export interface ToolCardSlotDeclaration extends BaseSlotDeclaration {
  readonly type: "toolCard";
  /** Tool names this slot handles. */
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
export interface CompactToolCardSlotDeclaration extends BaseSlotDeclaration {
  readonly type: "compactToolCard";
  /** Tool names this slot handles. */
  readonly toolNames: readonly string[];
}

export interface InlinePromptSlotDeclaration extends BaseSlotDeclaration {
  readonly type: "inlinePrompt";
}

/**
 * A headerBar slot renders a thin full-width bar above the tab bar.
 *
 * The host creates a sandboxed iframe, subscribes to session state,
 * and pushes state updates via {@link HeaderBarHostMessage}.
 */
export interface HeaderBarSlotDeclaration extends BaseSlotDeclaration {
  readonly type: "headerBar";
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
  /** The owning session id. */
  readonly sessionId: string;
  /** The agent name — `"main"` for the primary agent. */
  readonly agentName: string;
  /** The conversation id — `"main"` for the primary conversation. */
  readonly conversationId: string;
}
