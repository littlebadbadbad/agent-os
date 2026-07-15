/**
 * agent-UI/slots/renderers/PanelSlotRenderer.tsx
 *
 * Renders a panel slot as a sandboxed iframe.
 * Host creation and session subscription are delegated to
 * {@link useSlotHostBridge}.
 */

import { type ReactElement } from "react";
import { IframeSandbox } from "../IframeSandbox";
import { useSlotHostBridge } from "../hooks/useSlotHostBridge";
import type { SlotSession } from "@agent-type";
import { usePluginSystem } from "../../plugin/PluginContext";

export interface PanelSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly toolSetSymbol: symbol;
  readonly className?: string;
}

export function PanelSlotRenderer(
  props: PanelSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, toolSetSymbol, className } = props;

  const { getPlugin } = usePluginSystem();
  const uiPlugin = getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  const { host, handleReady } = useSlotHostBridge({
    session,
    pluginId,
    slotId,
    slotType: "panel",
    toolSetSymbol,
    uiPlugin,
  });

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
    />
  );
}
