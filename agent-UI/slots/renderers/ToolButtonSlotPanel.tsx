/**
 * agent-UI/slots/renderers/ToolButtonSlotPanel.tsx
 *
 * Renders a toolButton slot — the iframe panel that appears inside a
 * DropdownPanel when the user clicks a toolButton in the AIControlBar.
 *
 * Reuses the same {@link useSlotHostBridge} pattern as {@link PanelSlotRenderer}
 * but with slotType "toolButton" and a "fill" sizing hint so the iframe
 * fills the DropdownPanel container.
 */

import { type ReactElement } from "react";
import { IframeSandbox } from "../IframeSandbox";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession } from "@agent-type";
import { usePluginSystem, useSlotRegistry } from "../../plugin/PluginContext";
import styles from "./ToolButtonSlotPanel.module.scss";

export interface ToolButtonSlotPanelProps {
  readonly pluginId: string;
  readonly slotId: string;
  /** Session — may be null for session-independent toolButton slots. */
  readonly session?: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function ToolButtonSlotPanel(
  props: ToolButtonSlotPanelProps,
): ReactElement | null {
  const { pluginId, slotId, session, toolSetSymbol, className } = props;

  const { getPlugin } = usePluginSystem();
  const uiPlugin = getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  const { getSlot } = useSlotRegistry();
  const slotEntry = getSlot(pluginId, slotId);
  // Discriminant narrowing — no cast needed.
  const btnDecl = slotEntry?.declaration.type === "toolButton" ? slotEntry.declaration : undefined;

  const { host, handleReady } = useSlotHostBridge({
    session,
    pluginId,
    slotId,
    slotType: "toolButton",
    toolSetSymbol,
    uiPlugin,
  });

  return (
    <IframeSandbox
      className={`${styles['panel']}${className ? ` ${className}` : ''}`}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fill"
      containingWidth={btnDecl?.containingWidth}
      containingHeight={btnDecl?.containingHeight}
      permissions={btnDecl?.permissions}
    />
  );
}
