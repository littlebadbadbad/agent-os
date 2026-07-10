/**
 * agent-UI/slots/SlotRenderer.tsx — Unified slot renderer entry point
 *
 * Dispatches to the correct renderer based on `slotType`.
 * All slot declarations are read from the global `slotRegistry` only.
 *
 * `shouldRender` check happens at the top — before any renderer is invoked:
 *   - declaration not found in registry → render (no gating)
 *   - `shouldRender` undefined → render
 *   - `shouldRender` returns `false` → skip
 *   - otherwise → render
 *
 * ALL slot types receive a `session` prop so `shouldRender` can evaluate
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
import { CompactToolCardSlotRenderer } from "./renderers/CompactToolCardSlotRenderer";
import { InlinePromptSlotRenderer } from "./renderers/InlinePromptSlotRenderer";
import { HeaderBarSlotRenderer } from "./renderers/HeaderBarSlotRenderer";
import { slotRegistry } from "./registry";
import { buildSlotDisplayContext } from "./context";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Unified shouldRender check.
 * Returns `true` when the slot should render.
 *
 * Rules:
 *   - If an explicit `declaration` is provided (sub-agent path), use it directly
 *   - Otherwise look up from the global slotRegistry (main-agent path)
 *   - If no declaration or `shouldRender` is not defined → render
 *   - If `shouldRender` returns `false` → skip
 *   - Otherwise → render
 */
function checkShouldRender(
  pluginId: string,
  slotId: string,
  session: SlotSession,
  declaration?: PluginSlotDeclaration,
): boolean {
  const decl = declaration ?? slotRegistry.getSlot(pluginId, slotId)?.declaration;
  if (!decl?.shouldRender) return true;
  const ctx = buildSlotDisplayContext(session);
  return decl.shouldRender(ctx);
}

// ── Discriminated props union ─────────────────────────────────────────────────
// All variants carry `session: SlotSession` so `shouldRender` can always
// be evaluated with the correct conversation context.

export type SlotRendererProps =
  | {
      readonly pluginId: string;
      readonly slotType: "panel";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly toolSetSymbol: symbol;
      readonly declaration?: PluginSlotDeclaration;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "toolCard";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly toolSetSymbol: symbol;
      readonly toolCallInfo: ToolCallInfo;
      readonly declaration?: PluginSlotDeclaration;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "compactToolCard";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly toolSetSymbol: symbol;
      readonly toolCallInfo: ToolCallInfo;
      /** Called when the compact card signals it should open the detail modal. */
      readonly onOpenDetail?: () => void;
      readonly declaration?: PluginSlotDeclaration;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "inlinePrompt";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly toolSetSymbol: symbol;
      readonly declaration?: PluginSlotDeclaration;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "headerBar";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly toolSetSymbol: symbol;
      readonly declaration?: PluginSlotDeclaration;
      readonly className?: string;
    };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Render a plugin slot by type.
 *
 * Type-safe dispatch: the props union ensures that `session` is
 * required for all slot types, with slot-specific props (`toolCallInfo`,
 * `onOpenDetail`) gated behind the `slotType` discriminant.
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
          toolCallInfo={props.toolCallInfo}
          toolSetSymbol={props.toolSetSymbol}
          className={props.className}
        />
      );

    case "compactToolCard":
      return (
        <CompactToolCardSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          toolCallInfo={props.toolCallInfo}
          toolSetSymbol={props.toolSetSymbol}
          onOpenDetail={props.onOpenDetail}
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

    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
