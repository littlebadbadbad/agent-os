import type {
  AppApiClient,
  UiAppHostInternal,
  SlotContext,
  SlotHostMessage,
  SlotSession,
  AppBridge,
} from "@agent-type";
import type { AppConfigClient } from "./configClient";
import { AppDescriptor } from "./appTypes";


// ── Factory params ────────────────────────────────────────────────────────────

export interface UiAppHostParams {
  /** App descriptor. */
  readonly app: AppDescriptor;
  /** Pre-bound API client for app backend communication. */
  readonly apiClient: AppApiClient;
  /** Configuration client for app settings. */
  readonly configClient: AppConfigClient;
  /** Active session (for getAppState). Accepts both main-agent sessions and sub-agent conversations. */
  readonly session?: SlotSession;
  /** Slot context — tells the iframe which slot instance it is rendering. */
  readonly slotContext: SlotContext;
  /** The ToolSet symbol whose state to expose via `getAppState()`. */
  readonly toolSetSymbol: symbol;
  /**
   * Shared bridge object — same reference as {@link AgentAppHost.bridge}.
   * Agent writes methods/properties during activation;
   * UI reads/calls them directly.
   */
  readonly bridge: AppBridge;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a UiAppHostInternal for injection into a app iframe.
 *
 * The returned object is injected into `iframe.contentWindow.__UAP_APP_HOST__`.
 * App UI code interacts only with the {@link UiAppHost} surface;
 * the `_`-prefixed methods are for host-side renderer use.
 */
export function createUiAppHost(params: UiAppHostParams): UiAppHostInternal {
  const { app, apiClient, configClient, session, slotContext, toolSetSymbol, bridge } = params;

  // ── Host→iframe: subscribers + message buffer ───────────────────────────
  //
  // Messages pushed via `_pushToIframe` before the iframe has registered
  // any `onSlotMessage` subscriber are buffered. When the first subscriber
  // registers, all buffered messages are replayed in order. This eliminates
  // the race where the host sends toolCallInfo before the iframe's module
  // script has executed.

  const iframeSubs = new Set<(msg: SlotHostMessage) => void>();
  const pendingHostToIframe: SlotHostMessage[] = [];

  return {
    get apiClient(): AppApiClient { return apiClient; },
    get appId(): string { return app.id; },
    get appName(): string { return app.name; },
    get appVersion(): string { return app.version; },
    get bridge(): AppBridge { return bridge; },

    getAppState() {
      if (!session) return undefined;
      const state = session.getState();
      const toolSetState = state[toolSetSymbol];
      if (!toolSetState) return undefined;
      return [{ ...state }, toolSetState];
    },

    getSlotContext() { return slotContext; },

    // ── Host → Iframe (app UI subscribes to this) ──────────────────────

    onSlotMessage(cb: (msg: SlotHostMessage) => void): () => void {
      iframeSubs.add(cb);

      // Replay any buffered messages on first subscription.
      if (pendingHostToIframe.length > 0) {
        const buffered = pendingHostToIframe.splice(0);
        for (const msg of buffered) {
          try { cb(msg); } catch (err) {
            console.warn("[UiAppHost] Replay delivery error:", err);
          }
        }
      }

      return () => { iframeSubs.delete(cb); };
    },

    getConfig<T = unknown>(key: string): T {
      return configClient.getConfig<T>(key);
    },

    onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void {
      return configClient.onConfigChanged(cb);
    },

    // ── Internal: host-side renderer API ──────────────────────────────────

    _pushToIframe(msg: SlotHostMessage): void {
      if (iframeSubs.size === 0) {
        // Iframe not ready yet — buffer for replay.
        pendingHostToIframe.push(msg);
        return;
      }
      iframeSubs.forEach((cb) => {
        try { cb(msg); } catch (err) {
          console.warn("[UiAppHost] Delivery error:", err);
        }
      });
    },
  };
}
