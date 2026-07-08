/**
 * agent-UI/slots/hooks/useSlotHostBridge.ts
 *
 * Shared Hook for slot renderers that push state to sandboxed iframes
 * via {@link UiPluginHostInternal._pushToIframe}.
 *
 * Encapsulates the common pattern used by HeaderBarSlotRenderer,
 * PanelSlotRenderer, and InlinePromptSlotRenderer:
 *   1. Create a UiPluginHost eagerly (with message buffering)
 *   2. Track it via a ref so handleReady / useEffect can access it
 *   3. Provide a handleReady callback that pushes the initial state
 *   4. Subscribe to session changes and push updates on every tick
 *
 * The caller still owns:
 *   - Plugin lookup & guard (hooks must not be called after early return)
 *   - IframeSandbox rendering (sizing, className, dimensions vary per slot)
 */

import { useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import type { SlotHostMessage, UiPluginHostInternal, SlotSession, SlotType } from '@agent-type';
import type { PluginManifest } from '@agent-type';
import { createUiPluginHost } from '../../plugin/uiHost';
import { createPluginApiClient } from '../../plugin/apiClient';
import { createPluginConfigClient } from '../../plugin/configClient';
import type { PluginDescriptor } from '../../plugin/pluginSystem';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UseSlotHostBridgeOptions {
  /** Session whose state changes are pushed to the iframe. */
  readonly session: SlotSession;
  /** Plugin id (used for API-scoped calls and slot-lookup). */
  readonly pluginId: string;
  /** Slot identifier (matches the declaration's `id`). */
  readonly slotId: string;
  /** Slot type — used for the slotContext and the message `type` field. */
  readonly slotType: SlotType;
  /** Plugin descriptor (must have `uiEntryUrl` — caller guards this). */
  readonly uiPlugin: PluginDescriptor;
}

export interface UseSlotHostBridgeResult {
  /** The host instance — pass to IframeSandbox. */
  readonly host: UiPluginHostInternal;
  /** Ref holding the host; IframeSandbox reads it for injection. */
  readonly hostRef: RefObject<UiPluginHostInternal | null>;
  /** Callback for IframeSandbox.onReady — pushes the initial state. */
  readonly handleReady: (iframe: HTMLIFrameElement) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Shared slot host bridge for {{@link HeaderBarSlotRenderer}},
 * {@link PanelSlotRenderer}, and {@link InlinePromptSlotRenderer}.
 *
 * Callers MUST resolve the plugin and guard on `uiEntryUrl` **before**
 * invoking this hook (hooks cannot be called after an early return).
 *
 * @example
 *   const uiPlugin = pluginSystem.getPlugin(pluginId);
 *   if (!uiPlugin?.uiEntryUrl) return null;
 *   const { host, hostRef, handleReady } = useSlotHostBridge({
 *     session, pluginId, slotId, slotType: 'panel', uiPlugin,
 *   });
 *   return <IframeSandbox uiEntryUrl={uiPlugin.uiEntryUrl} host={host} onReady={handleReady} />;
 */
export function useSlotHostBridge(
  opts: UseSlotHostBridgeOptions,
): UseSlotHostBridgeResult {
  const { session, pluginId, slotId, slotType, uiPlugin } = opts;

  const hostRef = useRef<UiPluginHostInternal | null>(null);

  // Create host eagerly so IframeSandbox can inject it on iframe load.
  // Memoised per (pluginId, session, slotId, slotType, uiPlugin).
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
      slotContext: {
        slotId,
        slotType,
        sessionId: session.getState().id,
        agentName: session.getState().agentName,
        conversationId: session.getState().conversationId,
      },
    });
  }, [pluginId, session, slotId, slotType, uiPlugin]);

  hostRef.current = host;

  // Push initial state when the iframe loads.
  // If the iframe hasn't registered an onSlotMessage subscriber yet,
  // the host buffers and replays it.
  const handleReady = useCallback(
    (_iframe: HTMLIFrameElement) => {
      const h = hostRef.current;
      if (!h) return;
      const msg = {
        version: 1 as const,
        type: slotType,
        slotId,
        payload: { state: session.getState() },
      } as SlotHostMessage;
      h._pushToIframe(msg);
    },
    [session, slotId, slotType],
  );

  // Subscribe to session state changes and push updates.
  useEffect(() => {
    const unsub = session.subscribe(() => {
      const h = hostRef.current;
      if (!h) return;
      const msg = {
        version: 1 as const,
        type: slotType,
        slotId,
        payload: { state: session.getState() },
      } as SlotHostMessage;
      h._pushToIframe(msg);
    });
    return () => {
      unsub();
    };
  }, [session, slotId, slotType]);

  return { host, hostRef, handleReady };
}
