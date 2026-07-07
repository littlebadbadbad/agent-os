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
 */

import { useRef, useMemo, useCallback, type ReactElement } from "react";
import type {
  CompactToolCardHostMessage,
  UiPluginHostInternal,
} from "@agent-type";
import type { ToolCallInfo } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { createUiPluginHost } from "../../plugin/uiHost";
import { createPluginApiClient } from "../../plugin/apiClient";
import { createPluginConfigClient } from "../../plugin/configClient";
import type { PluginManifest, CompactToolCardSlotDeclaration } from "@agent-type";
import { slotRegistry } from "../registry";
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

  // Read dimensions from slot declaration, fall back to sensible defaults.
  const decl = slotRegistry.getSlot(pluginId, slotId) as CompactToolCardSlotDeclaration | undefined;
  // Base-layer default: compact cards max out at 36px tall.
  // Plugins can override via containingHeight in their slot declaration.
  const containingWidth = decl?.containingWidth ?? "auto";
  const containingHeight = decl?.containingHeight ?? "36px";

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
      slotContext: {
        slotId,
        slotType: "compactToolCard",
        sessionId: '',
        agentName: 'main',
        conversationId: 'main',
      },
    });
  }, [pluginId, slotId, uiPlugin]);

  hostRef.current = host;

  const handleReady = useCallback(
    (_iframe: HTMLIFrameElement) => {
      const h = hostRef.current;
      if (!h) return;

      // Listen for iframe → host messages (only openDetail for compact cards).
      h._onIframeMessage((msg) => {
        if (msg.type === "openDetail") {
          onOpenDetail?.();
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
      containingWidth={containingWidth}
      containingHeight={containingHeight}
    />
  );
}
