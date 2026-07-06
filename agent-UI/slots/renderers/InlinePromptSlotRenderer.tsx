/**
 * agent-UI/slots/renderers/InlinePromptSlotRenderer.tsx
 *
 * Renders an inlinePrompt slot as a sandboxed iframe overlay.
 *
 * Follows the same pattern as PanelSlotRenderer:
 *   1. Create UiPluginHost eagerly (with message buffering)
 *   2. IframeSandbox injects host on iframe load
 *   3. handleReady pushes initial state + subscribes to session changes
 *   4. Session subscription pushes state changes via host._pushToIframe
 *
 * The plugin UI inside the iframe reads prompt data from
 * `host.getPluginState()[1]` (the first toolset's symbol-state)
 * and calls the responder function directly.
 */

import { useEffect, useRef, useMemo, type ReactElement } from "react";
import type { AgentSession } from "@agent-sdk";
import type { InlinePromptHostMessage, UiPluginHostInternal } from "@agent-type";
import { IframeSandbox } from "../IframeSandbox";
import { createUiPluginHost } from "../../plugin/uiHost";
import { createPluginApiClient } from "../../plugin/apiClient";
import { createPluginConfigClient } from "../../plugin/configClient";
import type { PluginManifest } from "@agent-type";
import { pluginSystem } from "../../agents";

export interface InlinePromptSlotRendererProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly session: AgentSession;
  readonly className?: string;
}

export function InlinePromptSlotRenderer(
  props: InlinePromptSlotRendererProps,
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
      slotContext: { slotId, slotType: "inlinePrompt" },
    });
  }, [pluginId, session, slotId, uiPlugin]);

  hostRef.current = host;

  // Push initial state when iframe loads.
  const handleReady = (_iframe: HTMLIFrameElement) => {
    const h = hostRef.current;
    if (!h) return;

    const initMsg: InlinePromptHostMessage = {
      version: 1,
      type: "inlinePrompt",
      slotId,
      payload: { state: session.getState() },
    };
    h._pushToIframe(initMsg);
  };

  // Subscribe to session state changes and push to iframe.
  useEffect(() => {
    const unsub = session.subscribe(() => {
      const h = hostRef.current;
      if (!h) return;
      const msg: InlinePromptHostMessage = {
        version: 1,
        type: "inlinePrompt",
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
      iframeWidth="100%"
      uiEntryUrl={uiPlugin.uiEntryUrl}
      host={host}
      onReady={handleReady}
      sizing="fit"
    />
  );
}
