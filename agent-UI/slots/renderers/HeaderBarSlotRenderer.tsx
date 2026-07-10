/**
 * agent-UI/slots/renderers/HeaderBarSlotRenderer.tsx
 *
 * Renders a headerBar slot as a sandboxed iframe.
 *
 * A headerBar slot is a thin full-width bar rendered above the tab bar.
 * Host creation and session subscription are delegated to
 * {@link useSlotHostBridge}.
 *
 * Uses `sizing="fit"` so dimensions are driven by the slot declaration's
 * `containingWidth`/`containingHeight` (e.g. "100%" × "28px").
 */

import { type ReactElement } from "react";
import type { HeaderBarSlotDeclaration, SlotSession } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import { slotRegistry } from "../registry";
import { pluginSystem } from "../../agents";

export interface HeaderBarSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function HeaderBarSlotRenderer(
  props: HeaderBarSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, toolSetSymbol, className } = props;

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  // Read dimensions from slot declaration, fall back to sensible defaults.
  const entry = slotRegistry.getSlot(pluginId, slotId);
  const decl = entry?.declaration as HeaderBarSlotDeclaration | undefined;
  const containingWidth = decl?.containingWidth ?? "100%";
  const containingHeight = decl?.containingHeight ?? "auto";

  const { host, handleReady } = useSlotHostBridge({
    session,
    pluginId,
    slotId,
    slotType: "headerBar",
    toolSetSymbol,
    uiPlugin,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fit"
      containingWidth={containingWidth}
      containingHeight={containingHeight}
    />
  );
}
