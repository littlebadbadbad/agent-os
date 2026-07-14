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
 *     pluginId="browser"
 *     slotType="panel"
 *     slotId="browser.main"
 *     session={session}
 *   />
 *
 *   <SlotRenderer
 *     pluginId="browser"
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
  PluginSlotDeclaration,
} from "@agent-type";
import { PanelSlotRenderer } from "./renderers/PanelSlotRenderer";
import { ToolCardSlotRenderer } from "./renderers/ToolCardSlotRenderer";
import { InlinePromptSlotRenderer } from "./renderers/InlinePromptSlotRenderer";
import { HeaderBarSlotRenderer } from "./renderers/HeaderBarSlotRenderer";
import { ToolButtonSlotPanel } from "./renderers/ToolButtonSlotPanel";
import { slotRegistry } from "./registry";
import { buildSlotDisplayContext } from "./context";

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
  pluginId: string,
  slotId: string,
  session: SlotSession,
  declaration?: PluginSlotDeclaration,
): boolean {
  const decl = declaration ?? slotRegistry.getSlot(pluginId, slotId)?.declaration;
  // Inline slot types never use the iframe dispatch — skip silently.
  if (!decl || decl.type === "compactToolCard" || decl.type === "autocomplete") return true;
  if (!decl.shouldRender) return true;
  const ctx = buildSlotDisplayContext(session);
  return decl.shouldRender(ctx);
}

// ── Base fields shared by every iframe slot renderer ──────────────────────────

interface IframeSlotRendererBase {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  readonly declaration?: PluginSlotDeclaration;
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
    };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Render a plugin slot by type.
 *
 * Type-safe dispatch: the intersection pattern ensures that common fields
 * (`pluginId`, `slotId`, `session`, `toolSetSymbol`) are shared across all
 * variants, while slot-specific props (`toolCallInfo`) are gated behind
 * the `slotType` discriminant.
 *
 * `shouldRender` is always evaluated upfront. Sub-agent slots that are
 * not registered globally (see discoverSubAgentSlots) will pass through
 * since `checkShouldRender` defaults to `true` when no declaration found.
 */
export function SlotRenderer(props: SlotRendererProps): ReactElement | null {
  // ── shouldRender gate — evaluated before dispatch ─────────────────────────
  if (!checkShouldRender(props.pluginId, props.slotId, props.session, props.declaration)) {
    return null;
  }

  // ── Dispatch to per-type renderer ─────────────────────────────────────────
  switch (props.slotType) {
    case "panel":
      return (
        <PanelSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          toolSetSymbol={props.toolSetSymbol}
          className={props.className}
        />
      );

    case "toolCard":
      return (
        <ToolCardSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          toolCallInfo={props.toolCallInfo}
          toolSetSymbol={props.toolSetSymbol}
          className={props.className}
        />
      );

    case "inlinePrompt":
      return (
        <InlinePromptSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          toolSetSymbol={props.toolSetSymbol}
          declaration={props.declaration}
          className={props.className}
        />
      );

    case "headerBar":
      return (
        <HeaderBarSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          toolSetSymbol={props.toolSetSymbol}
          className={props.className}
        />
      );

    case "toolButton":
      return (
        <ToolButtonSlotPanel
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          toolSetSymbol={props.toolSetSymbol}
          className={props.className}
        />
      );

    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
