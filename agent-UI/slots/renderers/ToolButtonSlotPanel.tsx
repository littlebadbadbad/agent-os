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
import { pluginSystem } from "../../agents";
import styles from "./ToolButtonSlotPanel.module.scss";

export interface ToolButtonSlotPanelProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function ToolButtonSlotPanel(
  props: ToolButtonSlotPanelProps,
): ReactElement | null {
  const { pluginId, slotId, session, toolSetSymbol, className } = props;

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

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
    />
  );
}
