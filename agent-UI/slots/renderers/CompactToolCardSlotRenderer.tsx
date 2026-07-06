/**
 * agent-UI/slots/renderers/CompactToolCardSlotRenderer.tsx
 *
 * Renders a compactToolCard slot as a sandboxed iframe.
 *
 * On iframe load, pushes {@link CompactToolCardHostMessage} with the
 * tool call information via `host._pushToIframe`.
 *
 * Listens for {@link CompactToolCardIframeMessage} from the iframe
 * via `host._onIframeMessage`:
 *   - `openDetail`: the user clicked the compact card → call `onOpenDetail`
 *     so the host can open the full detail modal.
 *   - `resize`: size report — updates iframe dimensions to fit content.
 */

import { useRef, useMemo, useCallback, useState, type ReactElement } from "react";
import type {
  CompactToolCardHostMessage,
  CompactToolCardIframeMessage,
  UiPluginHostInternal,
} from "@agent-type";
import type { ToolCallInfo } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { createUiPluginHost } from "../../plugin/uiHost";
import { createPluginApiClient } from "../../plugin/apiClient";
import { createPluginConfigClient } from "../../plugin/configClient";
import type { PluginManifest } from "@agent-type";
import { pluginSystem } from "../../agents";

export interface CompactToolCardSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly toolCallInfo: ToolCallInfo;
  /** Called when the iframe signals that the user clicked the compact card. */
  readonly onOpenDetail?: () => void;
  readonly className?: string;
}

export function CompactToolCardSlotRenderer(
  props: CompactToolCardSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, toolCallInfo, onOpenDetail, className } = props;

  const hostRef = useRef<UiPluginHostInternal | null>(null);

  // Dynamic iframe dimensions — updated when the iframe reports its content size.
  // Start at "auto" (browser default ~300×150) so the compact card has room to
  // render and measure itself.  The first resize report from the iframe will
  // shrink-wrap to the exact content dimensions.
  const [iframeWidth, setIframeWidth] = useState<string>("auto");
  const [iframeHeight, setIframeHeight] = useState<string>("auto");

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
      slotContext: { slotId, slotType: "compactToolCard" },
    });
  }, [pluginId, slotId, uiPlugin]);

  // Keep a ref to the host so handleReady can access it without re-creating.
  hostRef.current = host;

  const handleReady = useCallback(
    (_iframe: HTMLIFrameElement) => {
      const h = hostRef.current;
      if (!h) return;

      // Listen for iframe → host messages.
      h._onIframeMessage((msg) => {
        if (msg.type === "openDetail") {
          onOpenDetail?.();
        } else if (msg.type === "resize") {
          // Dynamic dimension adjustment — the iframe reports its content size.
          if (msg.payload?.width) setIframeWidth(`${msg.payload.width}px`);
          if (msg.payload?.height) setIframeHeight(`${msg.payload.height}px`);
        }
      });

      // Push initial toolCallInfo. If the iframe hasn't registered an
      // onSlotMessage subscriber yet, the host buffers and replays it.
      const initMsg: CompactToolCardHostMessage = {
        version: 1,
        type: "compactToolCard",
        slotId,
        payload: { toolCallInfo },
      };
      h._pushToIframe(initMsg);
    },
    [onOpenDetail, slotId, toolCallInfo],
  );

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fit"
      iframeWidth={iframeWidth}
      iframeHeight={iframeHeight}
    />
  );
}
