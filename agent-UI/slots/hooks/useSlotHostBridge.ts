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
import type { SlotHostMessage, UiPluginHostInternal, SlotSession, IframeSlotType, AgentApiHandler } from '@agent-type';
import type { PluginManifest } from '@agent-type';
import { createUiPluginHost } from '../../plugin/uiHost';
import { createPluginApiClient } from '../../plugin/apiClient';
import { createPluginConfigClient } from '../../plugin/configClient';
import type { PluginDescriptor } from '../../plugin/pluginSystem';
import { usePluginSystem } from '../../plugin/PluginContext';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UseSlotHostBridgeOptions {
  /**
   * Session whose state changes are pushed to the iframe.
   * `null` only for session-independent slots (e.g. toolButton without a
   * running session). The host still works — `getPluginState()` returns
   * `undefined`, and no state-push subscriptions are set up.
   */
  readonly session?: SlotSession | null;
  /** Plugin id (used for API-scoped calls and slot-lookup). */
  readonly pluginId: string;
  /** Slot identifier (matches the declaration's `id`). */
  readonly slotId: string;
  /** Slot type — used for the slotContext and the message `type` field. */
  readonly slotType: IframeSlotType;
  /** The ToolSet symbol whose state to expose. */
  readonly toolSetSymbol: symbol;
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
  const { session, pluginId, slotId, slotType, toolSetSymbol, uiPlugin } = opts;

  const hostRef = useRef<UiPluginHostInternal | null>(null);

  // Build slot context — null-safe for session-independent slots.
  const slotContext = useMemo(() => {
    if (!session) {
      return { slotId, slotType, sessionId: '', agentName: '', conversationId: '' };
    }
    const state = session.getState();
    return { slotId, slotType, sessionId: state.id, agentName: state.agentName, conversationId: state.conversationId };
  }, [session, slotId, slotType]);

  // Resolve agent-side API handlers from the plugin system.
  // These are registered by ToolSets via host.registerAgentApi during activation.
  // Only active plugins (successfully loaded agent entry) have agentApis.
  const activePlugin = usePluginSystem().getActivePlugin(pluginId);
  const agentApis = useMemo(
    () => activePlugin?.agentApis ?? new Map<string, AgentApiHandler>(),
    [activePlugin],
  );

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
      session: session ?? undefined,
      toolSetSymbol,
      slotContext,
      agentApis,
    });
  }, [pluginId, session, slotId, slotType, toolSetSymbol, uiPlugin, slotContext, agentApis]);

  hostRef.current = host;

  // Push initial state when the iframe loads.
  // When there's no session, there's nothing to push — the host still works
  // (getPluginState returns undefined), and the iframe can render without state.
  const handleReady = useCallback(
    (_iframe: HTMLIFrameElement) => {
      const h = hostRef.current;
      if (!h || !session) return;
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
  // When no session exists, there's nothing to subscribe to.
  useEffect(() => {
    if (!session) return;
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
