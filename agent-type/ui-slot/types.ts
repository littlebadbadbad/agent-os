/**
 * agent-type/ui-slot/types.ts — Slot declaration types
 *
 * Three-layer architecture:
 *   1. ToolSet registers slots via `host.registerToolSet(toolSet, slots)` — "what capabilities"
 *   2. Plugin UI (iframe) renders per slot via `host.getSlotContext()` — "what it looks like"
 *   3. Host renders slots via `SlotRenderer` + `SlotRegistry` — "where it goes"
 *
 * This file contains all slot declaration interfaces, the routing context
 * passed to display-control functions, and the SlotContext injected into iframes.
 *
 * Slots are registered independently from session state so that slot types
 * like `toolButton` can be discovered even without an active session.
 * Slot display callbacks receive the ToolSet's symbol state as an optional
 * second parameter (may be `undefined` when no session is active).
 */

import { PluginStateExtension } from "@agent-type";
import type { ToolCallInfo } from "../plugin";

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
 * Slot types that render inline (no iframe) — pure data or host-rendered.
 */
export type InlineSlotType = "compactToolCard" | "autocomplete";

/**
 * Slot types that render inside a sandboxed iframe.
 */
export type IframeSlotType =
  | "panel"
  | "toolCard"
  | "inlinePrompt"
  | "headerBar"
  | "toolButton"
  | "app";

/**
 * Discriminant for all plugin UI injection points.
 * Add new values here when introducing new slot types.
 */
export type SlotType = InlineSlotType | IframeSlotType;

// ═══════════════════════════════════════════════════════════════════════════════
//  IframeConfig — shared config fields for all iframe-based slot types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shared configuration fields for iframe-rendered slot types.
 *
 * Every iframe slot carries:
 *   - `shouldRender` (optional) — render-gating callback, checked per slot type
 *   - `containingWidth` / `containingHeight` (optional) — iframe sizing hints
 *   - `permissions` (optional) — Permissions Policy features granted to the iframe
 */
export interface IframeConfig {
  /**
   * Whether this slot should render.
   * Called on every session state change. Return `false` to hide the iframe.
   * When undefined, the slot always renders.
   * Receives routing context so plugins can filter by agent.
   */
  readonly shouldRender?: (ctx: SlotDisplayContext, state?: PluginStateExtension) => boolean;
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
  /**
   * Permissions Policy features granted to this slot's iframe
   * (e.g. `["pointer-lock", "fullscreen"]`).
   *
   * Each feature is translated into the matching iframe configuration:
   *   - the `allow` attribute (Permissions Policy),
   *   - the sandbox token when one exists (`pointer-lock` → `allow-pointer-lock`),
   *   - the dedicated attribute when one exists (`fullscreen` → `allowfullscreen`).
   *
   * A content site loaded in the slot (e.g. a 3D game) needs `pointer-lock`
   * to capture the mouse and `fullscreen` to fill the screen — without them
   * the browser denies `requestPointerLock()` / `requestFullscreen()`.
   *
   * Defaults to `["pointer-lock", "fullscreen"]` (see IframeSandbox).
   * Set `[]` to opt out of all optional permissions.
   */
  readonly permissions?: readonly string[];
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
export interface PanelSlotDeclaration extends IframeConfig {
  readonly type: "panel";
  /** Tab label shown in the sidebar tab bar. */
  readonly label: string;
  /** Whether to show a tab for this panel. Called on every state update.
   *  Receives routing context so plugins can differentiate main vs sub-agent. */
  readonly showTab: (ctx: SlotDisplayContext, state?: PluginStateExtension) => boolean;
  /** Optional emoji/icon for the tab. */
  readonly icon?: string;
  /**
   * Optional badge text shown next to the tab label.
   * Return `null` to hide the badge. Called on every state update.
   * Receives routing context and optional toolset state.
   */
  readonly badge?: (ctx: SlotDisplayContext, state?: PluginStateExtension) => string | null;
}

/**
 * A toolCard slot renders a tool-call result card in the chat stream.
 *
 * The host creates a sandboxed iframe and pushes
 * {@link ToolCardHostMessage} when a matching tool is invoked.
 */
export interface ToolCardSlotDeclaration extends IframeConfig {
  readonly type: "toolCard";
  /** Tool names this slot handles. */
  readonly toolNames: readonly string[];
}

/**
 * Structured descriptor returned by a compactToolCard slot's
 * `getDescriptor` factory — the UI renders this as a single-row pill.
 */
export interface CompactToolCardDescriptor {
  /** Emoji / icon character. */
  readonly icon: string;
  /** Short label (e.g. "Install Skill"). */
  readonly label: string;
  /** One-line dynamic summary (e.g. "Installed foo-skill"). */
  readonly summary: string;
  /** Current tool call status. */
  readonly status: "running" | "done" | "error";
}

/**
 * A compactToolCard slot renders the single-row pill representation of a
 * tool call — the collapsed form shown in the chat stream before the user
 * clicks to open the full detail modal.
 *
 * Unlike other slot types, compactToolCard is rendered inline by the host
 * using the descriptor returned by `getDescriptor`, never via iframe.
 */
export interface CompactToolCardSlotDeclaration {
  readonly type: "compactToolCard";
  /** Tool names this slot handles. */
  readonly toolNames: readonly string[];
  /**
   * Build the descriptor used by the host to render the inline pill.
   * Receives the full ToolCallInfo so the plugin can derive icon, label
   * and summary from the tool name, arguments, result, and status.
   */
  readonly getDescriptor: (info: ToolCallInfo) => CompactToolCardDescriptor;
  /**
   * Optional imperative render function for embedded same-process mode.
   * When provided, the host creates a `<div>` and calls this function
   * with the DOM element and the ToolCallInfo.
   */
  readonly render?: (dom: HTMLElement, info: ToolCallInfo) => void;
}

export interface InlinePromptSlotDeclaration extends IframeConfig {
  readonly type: "inlinePrompt";
}

/**
 * A headerBar slot renders a thin full-width bar above the tab bar.
 *
 * The host creates a sandboxed iframe, subscribes to session state,
 * and pushes state updates via {@link HeaderBarHostMessage}.
 */
export interface HeaderBarSlotDeclaration extends IframeConfig {
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
 */
export interface ToolButtonSlotDeclaration extends IframeConfig {
  readonly type: "toolButton";
  /** Button label shown in the AIControlBar. */
  readonly label: string;
  /** Optional emoji/icon for the button. */
  readonly icon?: string;
  /** Whether to show this button. Called on every state update. */
  readonly showBtn: (ctx: SlotDisplayContext, state?: PluginStateExtension) => boolean;
  /**
   * Optional badge text shown next to the button label.
   * Return `null` to hide the badge. Called on every state update.
   */
  readonly badge?: (ctx: SlotDisplayContext, state?: PluginStateExtension) => string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  App slot — Windows-style app launcher icon + floating window
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * An app slot renders an icon on the app launcher taskbar.
 *
 * Clicking the icon opens a floating, draggable, resizable window
 * containing the plugin's sandboxed iframe.  Multiple app windows
 * can be open simultaneously, independent of any chat session.
 *
 * The iframe receives state updates via {@link AppHostMessage}.
 */
export interface AppSlotDeclaration extends IframeConfig {
  readonly type: "app";
  /** Icon shown in the app launcher bar (emoji or text). */
  readonly icon: string;
  /** Display name shown in the app window title bar and tooltip. */
  readonly label: string;
  readonly defaultWidth?: number;
  /** Default window height in pixels. Default 400. */
  readonly defaultHeight?: number;
  /** Whether the window can be resized. Default true. */
  readonly resizable?: boolean;
  /** Whether the window can be minimized. Default true. */
  readonly minimizable?: boolean;
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
 * Context passed to {@link AutocompleteSlotDeclaration.shouldTrigger} so a
 * slot can decide whether to open the autocomplete dropdown.
 *
 * The host builds this on every keystroke and asks each registered
 * autocomplete slot "should I open the menu for you right now?".
 *
 * Fields:
 * - `value`     — the full textarea value at this moment.
 * - `cursor`    — the caret position (0-based index into `value`).
 * - `textBefore`— `value.slice(0, cursor)` — the text the user has typed
 *                  up to (and not including) the caret.  This is the most
 *                  useful field for trigger detection: a slot that wants
 *                  "slash at the start of a line" checks
 *                  `textBefore` starts with `/`; a slot that wants
 *                  "slash anywhere" checks `textBefore` ends with `/`.
 */
export interface AutocompleteTriggerContext {
  /** Full textarea value. */
  readonly value: string;
  /** Caret position (0-based index into `value`). */
  readonly cursor: number;
  /** `value.slice(0, cursor)` — text before the caret. */
  readonly textBefore: string;
}

/**
 * Result returned by {@link AutocompleteSlotDeclaration.shouldTrigger}.
 *
 * - `false`  — do not open the menu.
 * - `number` — open the menu; the number is the **start offset** (0-based
 *   index into `value`) of the text that should be replaced when the user
 *   selects an item.  For a leading-slash slot this is `0`; for an
 *   inline `@`-mention slot it is the index of the `@`.
 */
export type AutocompleteTriggerResult = false | number;

/**
 * An autocomplete slot provides items for the ChatInput autocomplete menu.
 *
 * This slot has NO iframe — it is a pure data slot.  The host renders
 * the autocomplete dropdown natively and calls `getItems(ctx)` to
 * retrieve the current item list on each state change.
 *
 * NOTE: This declaration does NOT extend {@link IframeConfig} because
 * autocomplete has no iframe — no `shouldRender`, no `containingWidth`, no
 * `containingHeight`.  The trigger condition is expressed via
 * `shouldTrigger`.
 */
export interface AutocompleteSlotDeclaration {
  readonly type: "autocomplete";
  /**
   * Decide whether the autocomplete dropdown should open for the current
   * input state.
   *
   * Called on every keystroke.  Return `false` to stay closed, or a
   * number (the start offset of the replaceable text) to open the menu.
   *
   * For the common "prefix at start of input" pattern, use the
   * {@link startsWithPrefix} helper:
   * ```ts
   * shouldTrigger: startsWithPrefix("/")
   * ```
   */
  readonly shouldTrigger: (ctx: AutocompleteTriggerContext) => AutocompleteTriggerResult;
  /**
   * Return autocomplete items for the current routing context.
   * Called on every state change so items stay in sync.
   */
  readonly getItems: (ctx: SlotDisplayContext) => readonly AutocompleteItem[];
}

// ── Trigger helpers ───────────────────────────────────────────────────────────

/**
 * Create a `shouldTrigger` function that opens the menu when `textBefore`
 * starts with the given prefix (i.e. the prefix is at the very beginning
 * of the input).
 *
 * This is the standard "slash-command" pattern: the menu opens only when
 * the user types `/` as the first character.
 *
 * @param prefix  e.g. `"/"` or `"/mcp:"`
 * @returns a `shouldTrigger` function suitable for
 *          {@link AutocompleteSlotDeclaration.shouldTrigger}.
 */
export function startsWithPrefix(prefix: string): (ctx: AutocompleteTriggerContext) => AutocompleteTriggerResult {
  return (ctx) => {
    if (ctx.textBefore.startsWith(prefix)) return 0;
    return false;
  };
}

/**
 * Create a `shouldTrigger` function that opens the menu when the prefix
 * appears immediately before the caret, regardless of where it is in the
 * input (inline-mention pattern).
 *
 * The returned start offset is the index of the prefix occurrence closest
 * to the caret.
 *
 * @param prefix  e.g. `"@"` or `"#"`
 * @returns a `shouldTrigger` function suitable for
 *          {@link AutocompleteSlotDeclaration.shouldTrigger}.
 */
export function inlinePrefix(prefix: string): (ctx: AutocompleteTriggerContext) => AutocompleteTriggerResult {
  const idx = (ctx: AutocompleteTriggerContext): number => {
    const { textBefore } = ctx;
    const i = textBefore.lastIndexOf(prefix);
    if (i < 0) return -1;
    // Ensure the character before the prefix is whitespace or start-of-input
    // (avoids matching `@` inside an email address).
    if (i > 0) {
      const prev = textBefore[i - 1];
      if (prev !== ' ' && prev !== '\n' && prev !== '\t') return -1;
    }
    return i;
  };
  return (ctx) => {
    const i = idx(ctx);
    return i < 0 ? false : i;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Category-level discriminated unions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Slot types that do NOT use an iframe — rendered inline by the host
 * using descriptor data or native UI components.
 */
export type InlineSlotDeclaration =
  | CompactToolCardSlotDeclaration
  | AutocompleteSlotDeclaration;

/**
 * Slot types that render inside a sandboxed iframe.
 */
export type IframeSlotDeclaration =
  | PanelSlotDeclaration
  | ToolCardSlotDeclaration
  | InlinePromptSlotDeclaration
  | HeaderBarSlotDeclaration
  | ToolButtonSlotDeclaration
  | AppSlotDeclaration;

/**
 * Discriminated union of all slot declarations.
 *
 * A plugin's ToolSet returns this array as the second argument to
 * `host.registerToolSet(toolSet, slots)`.
 */
export type PluginSlotDeclaration = InlineSlotDeclaration | IframeSlotDeclaration;

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
  /**
   * The type of slot being rendered.
   * Only iframe-based slots call `getSlotContext()` — inline slots
   * like `compactToolCard` / `autocomplete` are rendered natively and
   * never receive a SlotContext.
   */
  readonly slotType: IframeSlotType;
  /** The owning session id. */
  readonly sessionId: string;
  /** The agent name — `"main"` for the primary agent. */
  readonly agentName: string;
  /** The conversation id — `"main"` for the primary conversation. */
  readonly conversationId: string;
}
