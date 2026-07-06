/**
 * agent-UI/slots/renderers/ToolbarButtonSlotRenderer.tsx
 *
 * Renders an inline button for a toolbarButton slot.
 *
 * No iframe — the host renders a native button.  Click dispatches
 * to the plugin via the host's apiClient.
 */

import { useCallback, type ReactElement } from "react";
import type { ToolbarButtonSlotDeclaration } from "@agent-type";
import { createPluginApiClient } from "../../plugin/apiClient";
import { slotRegistry } from "../registry";

export interface ToolbarButtonSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly className?: string;
}

export function ToolbarButtonSlotRenderer(
  props: ToolbarButtonSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, className } = props;

  const declaration = slotRegistry.getSlot(pluginId, slotId);
  if (!declaration || declaration.type !== "toolbarButton") return null;

  const enabled = declaration.enabled?.() ?? true;

  const handleClick = useCallback(() => {
    const apiClient = createPluginApiClient(pluginId);
    // Fire-and-forget: call plugin backend method.
    apiClient.call("toolbar.click", { slotId }).catch((err) => {
      console.warn(`[ToolbarButtonSlot] Click failed for ${pluginId}/${slotId}:`, err);
    });
  }, [pluginId, slotId]);

  return (
    <button
      type="button"
      className={className}
      title={declaration.tooltip}
      disabled={!enabled}
      onClick={handleClick}
      aria-label={declaration.tooltip ?? declaration.icon}
    >
      {declaration.icon}
    </button>
  );
}
