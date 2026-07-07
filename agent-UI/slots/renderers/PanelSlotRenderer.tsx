/**
 * agent-UI/slots/renderers/PanelSlotRenderer.tsx
 *
 * Renders a panel slot as a sandboxed iframe.
 *
 * Subscribes to session state changes and pushes
 * {@link PanelHostMessage} to the iframe via `host._pushToIframe`.
 *
 * The iframe re-reads `host.getPluginState()` when notified,
 * matching the current Link B pattern.
 *
 * Flow:
 *   1. Create UiPluginHost eagerly (with message buffering)
 *   2. IframeSandbox injects host on iframe load
 *   3. handleReady pushes initial state + subscribes to session changes
 *   4. Session subscription pushes state changes via host._pushToIframe
 */

import { useEffect, useRef, useMemo, type ReactElement } from "react";
import type { PanelHostMessage, UiPluginHostInternal, SlotSession } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { createUiPluginHost } from "../../plugin/uiHost";
import { createPluginApiClient } from "../../plugin/apiClient";
import { createPluginConfigClient } from "../../plugin/configClient";
import type { PluginManifest } from "@agent-type";
import { pluginSystem } from "../../agents";

export interface PanelSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly className?: string;
}

export function PanelSlotRenderer(
  props: PanelSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, className } = props;

  const hostRef = useRef<UiPluginHostInternal | null>(null);

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  // Create host eagerly so IframeSandbox can inject it on iframe load.
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
      session,
      slotContext: { slotId, slotType: "panel" },
    });
  }, [pluginId, session, slotId, uiPlugin]);

  hostRef.current = host;

  // Wire bridge once iframe loads.
  const handleReady = (_iframe: HTMLIFrameElement) => {
    const h = hostRef.current;
    if (!h) return;

    // Push initial state. If the iframe hasn't registered an onSlotMessage
    // subscriber yet, the host buffers and replays it.
    const initMsg: PanelHostMessage = {
      version: 1,
      type: "panel",
      slotId,
      payload: { state: session.getState() },
    };
    h._pushToIframe(initMsg);
  };

  // Subscribe to session state changes.
  useEffect(() => {
    const unsub = session.subscribe(() => {
      const h = hostRef.current;
      if (!h) return;
      const msg: PanelHostMessage = {
        version: 1,
        type: "panel",
        slotId,
        payload: { state: session.getState() },
      };
      h._pushToIframe(msg);
    });
    return () => {
      unsub();
    };
  }, [session, slotId]);

  return (
    <IframeSandbox
      className={className}
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
    />
  );
}
