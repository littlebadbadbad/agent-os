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
  | "headerBar"
  | "toolButton"
  | "autocomplete";

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

// ═══════════════════════════════════════════════════════════════════════════════
//  ToolButton slot — AIControlBar top-bar button
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A toolButton slot renders a button in the AIControlBar header bar.
 *
 * Clicking the button opens a DropdownPanel containing the plugin's iframe
 * management panel.  The iframe receives state updates via
 * {@link ToolButtonHostMessage}.
 *
 * NOTE: This declaration does NOT extend {@link BaseSlotDeclaration} because
 * toolButton has no `shouldRender` / `containingWidth` / `containingHeight`
 * — button visibility is controlled by `showTab`, and iframe sizing is
 * configured inside {@link ToolButtonSlotPanel}.
 */
export interface ToolButtonSlotDeclaration {
  readonly type: "toolButton";
  /** Button label shown in the AIControlBar. */
  readonly label: string;
  /** Optional emoji/icon for the button. */
  readonly icon?: string;
  /** Sort order in the AIControlBar (lower = first). Default 100. */
  readonly order?: number;
  /** Whether to show this button. Called on every state update. */
  readonly showBtn: (ctx: SlotDisplayContext) => boolean;
  /**
   * Optional badge text shown next to the button label.
   * Return `null` to hide the badge. Called on every state update.
   */
  readonly badge?: (ctx: SlotDisplayContext) => string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Autocomplete slot — ChatInput native autocomplete (no iframe)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * An item shown in the autocomplete dropdown.
 */
export interface AutocompleteItem {
  /** Unique identifier for this item. */
  readonly id: string;
  /** Display label (e.g. `"/command-name"`). */
  readonly label: string;
  /** Short description shown below or beside the label. */
  readonly description: string;
  /** Text inserted into the input when selected (e.g. `"/command-name "`). */
  readonly insertText: string;
}

/**
 * An autocomplete slot provides items for the ChatInput autocomplete menu.
 *
 * This slot has NO iframe — it is a pure data slot.  The host renders
 * the autocomplete dropdown natively and calls `getItems(ctx)` to
 * retrieve the current item list on each state change.
 *
 * NOTE: This declaration does NOT extend {@link BaseSlotDeclaration} because
 * autocomplete has no iframe — no `shouldRender`, no `containingWidth`, no
 * `containingHeight`.  The trigger condition is expressed via `prefix`.
 */
export interface AutocompleteSlotDeclaration {
  readonly type: "autocomplete";
  /**
   * Trigger prefix, e.g. `"/"` for command name completion.
   * When the user types this prefix, the autocomplete dropdown opens.
   */
  readonly prefix: string;
  /**
   * Return autocomplete items for the current routing context.
   * Called on every state change so items stay in sync.
   */
  readonly getItems: (ctx: SlotDisplayContext) => readonly AutocompleteItem[];
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
  | HeaderBarSlotDeclaration
  | ToolButtonSlotDeclaration
  | AutocompleteSlotDeclaration;

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
  /** The slot's unique id, auto-generated by the host from plugin + toolset + index. */
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
// ═══════════════════════════════════════════════════════════════════════════════
//  Plugin UI adapter (ToolSet → host slot declaration bridge)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Marker interface for plugin adapters injected into session state.
 *
 * Plugins that provide UI capabilities inject their adapter into
 * `AgentSessionState` via `onGetSymbolState`. The host UI iterates
 * declared slot declarations to dynamically render injection points —
 * no plugin name is hardcoded in the host UI.
 *
 * Concrete adapters (e.g. `BrowserAdapter`) extend this interface with
 * their plugin-specific methods.
 */
export interface PluginUiAdapter {
  /**
   * UI injection points declared by this plugin's ToolSets.
   *
   * Each slot declares a type ("panel", "toolCard", etc.) and an id.
   * The host reads this array to determine where and how to render
   * the plugin's UI.  Multiple ToolSets from the same plugin can
   * contribute different slots — the host merges them.
   */
  readonly slots?: readonly PluginSlotDeclaration[];
}