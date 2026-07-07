/**
 * agent-UI/slots/SlotRenderer.tsx — Unified slot renderer entry point
 *
 * Dispatches to the correct renderer based on `slotType`.
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
 *     toolCallInfo={info}
 *   />
 */

import { type ReactElement } from "react";
import type {
  SlotType,
  ToolCallInfo,
  SlotSession,
} from "@agent-type";
import { PanelSlotRenderer } from "./renderers/PanelSlotRenderer";
import { ToolCardSlotRenderer } from "./renderers/ToolCardSlotRenderer";
import { CompactToolCardSlotRenderer } from "./renderers/CompactToolCardSlotRenderer";
import { InlinePromptSlotRenderer } from "./renderers/InlinePromptSlotRenderer";
import { HeaderBarSlotRenderer } from "./renderers/HeaderBarSlotRenderer";
import { slotRegistry } from "./registry";

// ── Discriminated props union ─────────────────────────────────────────────────

export type SlotRendererProps =
  | {
      readonly pluginId: string;
      readonly slotType: "panel";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "toolCard";
      readonly slotId: string;
      readonly toolCallInfo: ToolCallInfo;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "compactToolCard";
      readonly slotId: string;
      readonly toolCallInfo: ToolCallInfo;
      /** Called when the compact card signals it should open the detail modal. */
      readonly onOpenDetail?: () => void;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "inlinePrompt";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly className?: string;
    }
  | {
      readonly pluginId: string;
      readonly slotType: "headerBar";
      readonly slotId: string;
      readonly session: SlotSession;
      readonly className?: string;
    };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Render a plugin slot by type.
 *
 * Type-safe dispatch: the props union ensures that `session` is
 * required for "panel" slots, `toolCallInfo` for "toolCard", etc.
 */
export function SlotRenderer(props: SlotRendererProps): ReactElement | null {
  switch (props.slotType) {
    case "panel":
      return (
        <PanelSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          className={props.className}
        />
      );

    case "toolCard":
      return (
        <ToolCardSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          toolCallInfo={props.toolCallInfo}
          className={props.className}
        />
      );

    case "compactToolCard":
      return (
        <CompactToolCardSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          toolCallInfo={props.toolCallInfo}
          onOpenDetail={props.onOpenDetail}
          className={props.className}
        />
      );

    case "inlinePrompt": {
      const decl = slotRegistry.getSlot(props.pluginId, props.slotId);
      if (
        decl?.type === "inlinePrompt" &&
        !decl.shouldRender()
      ) {
        return null;
      }
      return (
        <InlinePromptSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          className={props.className}
        />
      );
    }

    case "headerBar": {
      const decl = slotRegistry.getSlot(props.pluginId, props.slotId);
      if (
        decl?.type === "headerBar" &&
        !decl.shouldRender()
      ) {
        return null;
      }
      return (
        <HeaderBarSlotRenderer
          pluginId={props.pluginId}
          slotId={props.slotId}
          session={props.session}
          className={props.className}
        />
      );
    }

    default: {
      const _exhaustive: never = props;
      return _exhaustive;
    }
  }
}
