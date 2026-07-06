/**
 * agent-UI/slots/renderers/ToolCardSlotRenderer.tsx
 *
 * Renders a toolCard slot as a sandboxed iframe.
 *
 * On iframe load, pushes {@link ToolCardHostMessage} with the
 * tool call information via `host._pushToIframe`.
 */

import { useRef, useMemo, type ReactElement } from "react";
import type { ToolCardHostMessage, UiPluginHostInternal } from "@agent-type";
import type { ToolCallInfo } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { createUiPluginHost } from "../../plugin/uiHost";
import { createPluginApiClient } from "../../plugin/apiClient";
import { createPluginConfigClient } from "../../plugin/configClient";
import type { PluginManifest } from "@agent-type";
import { pluginSystem } from "../../agents";

export interface ToolCardSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly toolCallInfo: ToolCallInfo;
  readonly className?: string;
}

export function ToolCardSlotRenderer(
  props: ToolCardSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, toolCallInfo, className } = props;

  const hostRef = useRef<UiPluginHostInternal | null>(null);

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  const host: UiPluginHostInternal = useMemo(() => {
    const apiClient = createPluginApiClient(pluginId);
    const manifest: PluginManifest = {
      id: uiPlugin.id,
      name: uiPlugin.name,
      version: uiPlugin.version,
      description: uiPlugin.description,
    };
    const configClient = createPluginConfigClient(manifest, apiClient);

    return createUiPluginHost({
      plugin: uiPlugin,
      apiClient,
      configClient,
      slotContext: { slotId, slotType: "toolCard" },
    });
  }, [pluginId, slotId, uiPlugin]);

  hostRef.current = host;

  const handleReady = (_iframe: HTMLIFrameElement) => {
    const h = hostRef.current;
    if (!h) return;

    // Push initial toolCallInfo. If the iframe hasn't registered an
    // onSlotMessage subscriber yet, the host buffers and replays it.
    const initMsg: ToolCardHostMessage = {
      version: 1,
      type: "toolCard",
      slotId,
      payload: { toolCallInfo },
    };
    h._pushToIframe(initMsg);
  };

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
    />
  );
}
