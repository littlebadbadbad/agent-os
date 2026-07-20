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
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession, AppSlotDeclaration } from "@agent-type";
import { usePluginSystem, useSlotRegistry } from "../../plugin/PluginContext";

export interface AppSlotPanelProps {
  readonly pluginId: string;
  readonly slotId: string;
  /** Session may be null — app windows are session-independent. */
  readonly session?: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function AppSlotPanel(
  props: AppSlotPanelProps,
): ReactElement | null {
  const { pluginId, slotId, session, toolSetSymbol, className } = props;

  const { getPlugin } = usePluginSystem();
  const uiPlugin = getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  const { getSlot } = useSlotRegistry();
  const slotEntry = getSlot(pluginId, slotId);
  const decl = slotEntry?.declaration as AppSlotDeclaration | undefined;

  const { host, handleReady } = useSlotHostBridge({
    session,
    pluginId,
    slotId,
    slotType: "app",
    toolSetSymbol,
    uiPlugin,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fill"
      containingWidth={decl?.containingWidth}
      containingHeight={decl?.containingHeight}
    />
  );
}
