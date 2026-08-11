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
import { useAppSystem, useSlotRegistry } from "../../app/AppContext";
import styles from "./ToolButtonSlotPanel.module.scss";

export interface ToolButtonSlotPanelProps {
  readonly appId: string;
  readonly slotId: string;
  /** Session — may be null for session-independent toolButton slots. */
  readonly session?: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function ToolButtonSlotPanel(
  props: ToolButtonSlotPanelProps,
): ReactElement | null {
  const { appId, slotId, session, toolSetSymbol, className } = props;

  const { getApp } = useAppSystem();
  const uiApp = getApp(appId);
  if (!uiApp?.uiEntryUrl) return null;

  const { getSlot } = useSlotRegistry();
  const slotEntry = getSlot(appId, slotId);
  // Discriminant narrowing — no cast needed.
  const btnDecl = slotEntry?.declaration.type === "toolButton" ? slotEntry.declaration : undefined;

  const { host, handleReady } = useSlotHostBridge({
    session,
    appId,
    slotId,
    slotType: "toolButton",
    toolSetSymbol,
    uiApp,
  });

  return (
    <IframeSandbox
      className={`${styles['panel']}${className ? ` ${className}` : ''}`}
      uiEntryUrl={uiApp.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fill"
      containingWidth={btnDecl?.containingWidth}
      containingHeight={btnDecl?.containingHeight}
      permissions={btnDecl?.permissions}
    />
  );
}
