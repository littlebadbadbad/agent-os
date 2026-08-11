/**
 * agent-UI/slots/hooks/useSlotHostBridge.ts
 *
 * Shared Hook for slot renderers that push state to sandboxed iframes
 * via {@link UiAppHostInternal._pushToIframe}.
 *
 * Encapsulates the common pattern used by HeaderBarSlotRenderer,
 * PanelSlotRenderer, and InlinePromptSlotRenderer:
 *   1. Create a UiAppHost eagerly (with message buffering)
 *   2. Track it via a ref so handleReady / useEffect can access it
 *   3. Provide a handleReady callback that pushes the initial state
 *   4. Subscribe to session changes and push updates on every tick
 *
 * The caller still owns:
 *   - App lookup & guard (hooks must not be called after early return)
 *   - IframeSandbox rendering (sizing, className, dimensions vary per slot)
 */

import { useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import type { SlotHostMessage, UiAppHostInternal, SlotSession, IframeSlotType, AppBridge } from '@agent-type';
import type { AppManifest } from '@agent-type';
import { createUiAppHost } from '../../app/uiHost';
import { createAppApiClient } from '../../app/apiClient';
import { createAppConfigClient } from '../../app/configClient';
import type { AppDescriptor } from '../../app/appSystem';
import { useAppSystem } from '../../app/AppContext';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UseSlotHostBridgeOptions {
  /**
   * Session whose state changes are pushed to the iframe.
   * `null` only for session-independent slots (e.g. toolButton without a
   * running session). The host still works — `getAppState()` returns
   * `undefined`, and no state-push subscriptions are set up.
   */
  readonly session?: SlotSession | null;
  /** App id (used for API-scoped calls and slot-lookup). */
  readonly appId: string;
  /** Slot identifier (matches the declaration's `id`). */
  readonly slotId: string;
  /** Slot type — used for the slotContext and the message `type` field. */
  readonly slotType: IframeSlotType;
  /** The ToolSet symbol whose state to expose. */
  readonly toolSetSymbol: symbol;
  /** App descriptor (must have `uiEntryUrl` — caller guards this). */
  readonly uiApp: AppDescriptor;
}

export interface UseSlotHostBridgeResult {
  /** The host instance — pass to IframeSandbox. */
  readonly host: UiAppHostInternal;
  /** Ref holding the host; IframeSandbox reads it for injection. */
  readonly hostRef: RefObject<UiAppHostInternal | null>;
  /** Callback for IframeSandbox.onReady — pushes the initial state. */
  readonly handleReady: (iframe: HTMLIFrameElement) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Shared slot host bridge for {{@link HeaderBarSlotRenderer}},
 * {@link PanelSlotRenderer}, and {@link InlinePromptSlotRenderer}.
 *
 * Callers MUST resolve the app and guard on `uiEntryUrl` **before**
 * invoking this hook (hooks cannot be called after an early return).
 *
 * @example
 *   const uiApp = appSystem.getApp(appId);
 *   if (!uiApp?.uiEntryUrl) return null;
 *   const { host, hostRef, handleReady } = useSlotHostBridge({
 *     session, appId, slotId, slotType: 'panel', uiApp,
 *   });
 *   return <IframeSandbox uiEntryUrl={uiApp.uiEntryUrl} host={host} onReady={handleReady} />;
 */
export function useSlotHostBridge(
  opts: UseSlotHostBridgeOptions,
): UseSlotHostBridgeResult {
  const { session, appId, slotId, slotType, toolSetSymbol, uiApp } = opts;

  const hostRef = useRef<UiAppHostInternal | null>(null);

  // Build slot context — null-safe for session-independent slots.
  const slotContext = useMemo(() => {
    if (!session) {
      return { slotId, slotType, sessionId: '', agentName: '', conversationId: '' };
    }
    const state = session.getState();
    return { slotId, slotType, sessionId: state.id, agentName: state.agentName, conversationId: state.conversationId };
  }, [session, slotId, slotType]);

  // Resolve the shared bridge object from the activated app.
  // The bridge is created by appSystem, populated by the agent-side
  // activate() function, and passed through to the UI iframe.
  const activeApp = useAppSystem().getActiveApp(appId);
  const bridge = useMemo(
    () => activeApp?.bridge ?? ({} as AppBridge),
    [activeApp],
  );

  // Create host eagerly so IframeSandbox can inject it on iframe load.
  // Memoised per (appId, session, slotId, slotType, uiApp).
  const host: UiAppHostInternal = useMemo(() => {
    const apiClient = createAppApiClient(appId);
    const manifest: AppManifest = {
      id: uiApp.id,
      name: uiApp.name,
      version: uiApp.version,
      description: uiApp.description,
    };
    const configClient = createAppConfigClient(manifest, apiClient);

    return createUiAppHost({
      app: uiApp,
      apiClient,
      configClient,
      session: session ?? undefined,
      toolSetSymbol,
      slotContext,
      bridge,
    });
  }, [appId, session, slotId, slotType, toolSetSymbol, uiApp, slotContext, bridge]);

  hostRef.current = host;

  // Push initial state when the iframe loads.
  // When there's no session, there's nothing to push — the host still works
  // (getAppState returns undefined), and the iframe can render without state.
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
