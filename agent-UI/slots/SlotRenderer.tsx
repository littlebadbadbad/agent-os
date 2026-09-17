/**
 * agent-UI/slots/SlotRenderer.tsx — Unified slot renderer entry point
 *
 * Dispatches to the correct renderer based on `slotType`.
 * All slot declarations are read from the global `slotRegistry` only.
 *
 * Only iframe-based slot types (IframeSlotType) are dispatched here —
 * inline slot types like compactToolCard / autocomplete are rendered
 * natively by their respective host components.
 *
 * `shouldRender` check happens at the top — before any renderer is invoked:
 *   - declaration not found in registry → render (no gating)
 *   - `shouldRender` undefined → render
 *   - `shouldRender` returns `false` → skip
 *   - otherwise → render
 *
 * ALL variants carry `session: SlotSession` so `shouldRender` can evaluate
 * the correct conversation context (main agent vs sub-agent).
 *
 * Usage:
 *   <SlotRenderer
 *     appId="browser"
 *     slotType="panel"
 *     slotId="browser.main"
 *     session={session}
 *   />
 *
 *   <SlotRenderer
 *     appId="browser"
 *     slotType="toolCard"
 *     slotId="browser.toolCard"
 *     session={session}
 *     toolCallInfo={info}
 *   />
 */

import { type ReactElement } from "react";
import type {
  ToolCallInfo,
  SlotSession,
  SlotDeclaration,
  AppStateExtension,
} from "@agent-type";
import type { SlotRegistry } from "./registry";
import { PanelSlotRenderer } from "./renderers/PanelSlotRenderer";
import { ToolCardSlotRenderer } from "./renderers/ToolCardSlotRenderer";
import { InlinePromptSlotRenderer } from "./renderers/InlinePromptSlotRenderer";
import { HeaderBarSlotRenderer } from "./renderers/HeaderBarSlotRenderer";
import { ToolButtonSlotPanel } from "./renderers/ToolButtonSlotPanel";
import { AppSlotPanel } from "./renderers/AppSlotPanel";
import { buildSlotDisplayContext } from "./context";
import { useSlotRegistry } from "../app/AppContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Unified shouldRender check for iframe-based slots.
 * Returns `true` when the slot should render.
 *
 * Rules:
 *   - If an explicit `declaration` is provided (sub-agent path), use it directly
 *   - Otherwise look up from the global slotRegistry (main-agent path)
 *   - If no declaration or `shouldRender` is not defined → render
 *   - If `shouldRender` returns `false` → skip
 *   - Otherwise → render
 *
 * Inline slot types (compactToolCard, autocomplete) are filtered out at
 * runtime — they never reach the iframe dispatch. This keeps the public
 * registry API simple (all slots in one map) while maintaining type safety
 * inside the renderer.
 */
function checkShouldRender(
  appId: string,
  slotId: string,
  session: SlotSession | null | undefined,
  getSlot: SlotRegistry["getSlot"],
  toolSetSymbol: symbol,
  declaration?: SlotDeclaration,
): boolean {
  const decl = declaration ?? getSlot(appId, slotId)?.declaration;
  // Inline slot types never use the iframe dispatch — skip silently.
  if (!decl || decl.type === "compactToolCard" || decl.type === "autocomplete") return true;

  // When no session exists, only session-independent slot types may render.
  // toolButton and app are session-independent — they render icons/bars/windows
  // that exist even without an active chat session.
  // Evaluate shouldRender with empty context and undefined state.
  if (!session) {
    if (decl.type !== "toolButton" && decl.type !== "app") return false;
    if (!decl.shouldRender) return true;
    return decl.shouldRender(
      { sessionId: "", agentName: "", conversationId: "" },
      undefined,
    );
  }

  if (!decl.shouldRender) return true;
  const ctx = buildSlotDisplayContext(session);
  const state = session.getState()[toolSetSymbol] as AppStateExtension | undefined;
  return decl.shouldRender(ctx, state);
}

// ── Base fields shared by every iframe slot renderer ──────────────────────────

interface IframeSlotRendererBase {
  readonly appId: string;
  readonly slotId: string;
  /** Session — may be null for session-independent slots (toolButton). */
  readonly session?: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly declaration?: SlotDeclaration;
  readonly className?: string;
}

// ── Discriminated props union (intersection with base) ────────────────────────

export type SlotRendererProps =
  | IframeSlotRendererBase & {
      readonly slotType: "panel";
    }
  | IframeSlotRendererBase & {
      readonly slotType: "toolCard";
      readonly toolCallInfo: ToolCallInfo;
    }
  | IframeSlotRendererBase & {
      readonly slotType: "inlinePrompt";
    }
  | IframeSlotRendererBase & {
      readonly slotType: "headerBar";
    }
  | IframeSlotRendererBase & {
      readonly slotType: "toolButton";
    }
  | IframeSlotRendererBase & {
      readonly slotType: "app";
    };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Render a app slot by type.
 *
 * Type-safe dispatch: the intersection pattern ensures that common fields
 * (`appId`, `slotId`, `session`, `toolSetSymbol`) are shared across all
 * variants, while slot-specific props (`toolCallInfo`) are gated behind
 * the `slotType` discriminant.
 *
 * `shouldRender` is always evaluated upfront. Sub-agent slots that are
 * not registered globally (see discoverSubAgentSlots) will pass through
 * since `checkShouldRender` defaults to `true` when no declaration found.
 */
export function SlotRenderer(props: SlotRendererProps): ReactElement | null {
  const {
    appId,
    slotId,
    session,
    toolSetSymbol,
    declaration,
    className,
  } = props;

  // ── shouldRender gate — evaluated before dispatch ─────────────────────────
  const { getSlot } = useSlotRegistry();
  if (!checkShouldRender(appId, slotId, session, getSlot, toolSetSymbol, declaration)) {
    return null;
  }

  // ── Dispatch to per-type renderer ─────────────────────────────────────────
  // Only toolButton accepts null session; other slot types guard with early return.
  switch (props.slotType) {
    case "panel":
      if (!session) return null;
      return (
        <PanelSlotRenderer
          appId={appId}
          slotId={slotId}
          session={session}
          toolSetSymbol={toolSetSymbol}
          className={className}
        />
      );

    case "toolCard":
      if (!session) return null;
      return (
        <ToolCardSlotRenderer
          appId={appId}
          slotId={slotId}
          session={session}
          toolCallInfo={props.toolCallInfo}
          toolSetSymbol={toolSetSymbol}
          className={className}
        />
      );

    case "inlinePrompt":
      if (!session) return null;
      return (
        <InlinePromptSlotRenderer
          appId={appId}
          slotId={slotId}
          session={session}
          toolSetSymbol={toolSetSymbol}
          declaration={declaration}
          className={className}
        />
      );

    case "headerBar":
      if (!session) return null;
      return (
        <HeaderBarSlotRenderer
          appId={appId}
          slotId={slotId}
          session={session}
          toolSetSymbol={toolSetSymbol}
          className={className}
        />
      );

    case "toolButton":
      return (
        <ToolButtonSlotPanel
          appId={appId}
          slotId={slotId}
          session={session}
          toolSetSymbol={toolSetSymbol}
          className={className}
        />
      );

    case "app":
      // App slots accept null session — the window renders without it.
      return (
        <AppSlotPanel
          appId={appId}
          slotId={slotId}
          session={session}
          toolSetSymbol={toolSetSymbol}
          className={className}
        />
      );

    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
