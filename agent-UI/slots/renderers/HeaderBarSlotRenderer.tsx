/**
 * agent-UI/slots/renderers/HeaderBarSlotRenderer.tsx
 *
 * Renders a headerBar slot as a sandboxed iframe.
 *
 * A headerBar slot is a thin full-width bar rendered above the tab bar.
 * It subscribes to session state changes and pushes
 * {@link HeaderBarHostMessage} to the iframe via `host._pushToIframe`.
 *
 * The iframe re-reads `host.getPluginState()` when notified,
 * matching the PanelSlotRenderer pattern.
 *
 * Uses `sizing="fit"` so dimensions are driven by the slot declaration's
 * `containingWidth`/`containingHeight` (e.g. "100%" × "28px").
 *
 * Flow:
 *   1. Create UiPluginHost eagerly (with message buffering)
 *   2. IframeSandbox injects host on iframe load
 *   3. handleReady pushes initial state + subscribes to session changes
 *   4. Session subscription pushes state changes via host._pushToIframe
 */

import { useEffect, useRef, useMemo, useCallback, type ReactElement } from "react";
import type { HeaderBarHostMessage, UiPluginHostInternal, SlotSession } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { createUiPluginHost } from "../../plugin/uiHost";
import { createPluginApiClient } from "../../plugin/apiClient";
import { createPluginConfigClient } from "../../plugin/configClient";
import type { PluginManifest, HeaderBarSlotDeclaration } from "@agent-type";
import { slotRegistry } from "../registry";
import { pluginSystem } from "../../agents";

export interface HeaderBarSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: SlotSession;
  readonly className?: string;
}

export function HeaderBarSlotRenderer(
  props: HeaderBarSlotRendererProps,
): ReactElement | null {
  const { pluginId, slotId, session, className } = props;

  const hostRef = useRef<UiPluginHostInternal | null>(null);

  const uiPlugin = pluginSystem.getPlugin(pluginId);
  if (!uiPlugin?.uiEntryUrl) return null;

  // Read dimensions from slot declaration, fall back to sensible defaults.
  const decl = slotRegistry.getSlot(pluginId, slotId) as HeaderBarSlotDeclaration | undefined;
  const containingWidth = decl?.containingWidth ?? "100%";
  const containingHeight = decl?.containingHeight ?? "auto";

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
      slotContext: { slotId, slotType: "headerBar" },
    });
  }, [pluginId, session, slotId, uiPlugin]);

  hostRef.current = host;

  // Wire bridge once iframe loads.
  const handleReady = useCallback(
    (_iframe: HTMLIFrameElement) => {
      const h = hostRef.current;
      if (!h) return;

      // Push initial state. If the iframe hasn't registered an onSlotMessage
      // subscriber yet, the host buffers and replays it.
      const initMsg: HeaderBarHostMessage = {
        version: 1,
        type: "headerBar",
        slotId,
        payload: { state: session.getState() },
      };
      h._pushToIframe(initMsg);
    },
    [session, slotId],
  );

  // Subscribe to session state changes.
  useEffect(() => {
    const unsub = session.subscribe(() => {
      const h = hostRef.current;
      if (!h) return;
      const msg: HeaderBarHostMessage = {
        version: 1,
        type: "headerBar",
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
      sizing="fit"
      containingWidth={containingWidth}
      containingHeight={containingHeight}
    />
  );
}
