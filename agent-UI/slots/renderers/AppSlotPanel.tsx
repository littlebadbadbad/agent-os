/**
 * agent-UI/slots/renderers/AppSlotPanel.tsx
 *
 * Renders an app slot — the iframe panel that appears inside an AppWindow
 * when the user clicks an app icon in the AppLauncher.
 *
 * Reuses the same {@link useSlotHostBridge} pattern as other iframe slot
 * renderers, with slotType "app" and "fill" sizing.
 */

import { type ReactElement } from "react";
import { IframeSandbox } from "../IframeSandbox";
import { getSlotPermissions } from "../iframePermissions";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession } from "@agent-type";
import { useAppSystem, useSlotRegistry } from "../../app/AppContext";

export interface AppSlotPanelProps {
  readonly appId: string;
  readonly slotId: string;
  /** Session may be null — app windows are session-independent. */
  readonly session?: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function AppSlotPanel(
  props: AppSlotPanelProps,
): ReactElement | null {
  const { appId, slotId, session, toolSetSymbol, className } = props;

  const { getApp } = useAppSystem();
  const uiApp = getApp(appId);
  if (!uiApp?.uiEntryUrl) return null;

  const { getSlot } = useSlotRegistry();
  const slotEntry = getSlot(appId, slotId);
  // Discriminant narrowing — no cast needed.
  const appDecl = slotEntry?.declaration.type === "app" ? slotEntry.declaration : undefined;

  const { host, handleReady } = useSlotHostBridge({
    session,
    appId,
    slotId,
    slotType: "app",
    toolSetSymbol,
    uiApp,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiApp.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fill"
      containingWidth={appDecl?.containingWidth}
      containingHeight={appDecl?.containingHeight}
      permissions={appDecl?.permissions}
    />
  );
}
