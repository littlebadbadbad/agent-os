/**
 * agent-UI/slots/renderers/PanelSlotRenderer.tsx
 *
 * Renders a panel slot as a sandboxed iframe.
 * Host creation and session subscription are delegated to
 * {@link useSlotHostBridge}.
 */

import { type ReactElement } from "react";
import { IframeSandbox } from "../IframeSandbox";
import { getSlotPermissions } from "../iframePermissions";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession } from "@agent-type";
import { useAppSystem, useSlotRegistry } from "../../app/AppContext";

export interface PanelSlotRendererProps {
  readonly appId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function PanelSlotRenderer(
  props: PanelSlotRendererProps,
): ReactElement | null {
  const { appId, slotId, session, toolSetSymbol, className } = props;

  const { getApp } = useAppSystem();
  const uiApp = getApp(appId);
  if (!uiApp?.uiEntryUrl) return null;

  const { getSlot } = useSlotRegistry();
  const { host, handleReady } = useSlotHostBridge({
    session,
    appId,
    slotId,
    slotType: "panel",
    toolSetSymbol,
    uiApp,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiApp.uiEntryUrl}
      host={host}
      onReady={handleReady}
      permissions={getSlotPermissions(getSlot(appId, slotId)?.declaration)}
    />
  );
}
