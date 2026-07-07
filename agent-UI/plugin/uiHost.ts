/**
 * agent-UI/plugin/uiHost.ts — UiPluginHost factory
 *
 * Creates a UiPluginHost instance that is injected into a plugin's
 * iframe sandbox via `iframe.contentWindow.__UAP_PLUGIN_HOST__`.
 *
 * The host provides the iframe with a complete capability surface:
 *   - **getPluginState()** — reads session state + symbol-keyed plugin slices
 *   - **getSlotContext()** — tells the iframe which slot it's rendering
 *   - **sendSlotMessage(msg)** / **onSlotMessage(cb)** — typed host↔iframe messaging
 *   - **apiClient** — pre-bound backend API client
 *   - **getConfig / onConfigChanged** — plugin configuration
 *
 * ## Communication model
 *
 * `sendSlotMessage` / `onSlotMessage` are the ONLY way plugins communicate
 * with the host. They abstract away all transport details so plugins
 * never touch `window.parent.postMessage` or `window.addEventListener`
 * directly.
 *
 * Because the host is injected as a same-realm reference (D6, requires
 * `allow-same-origin`), messages are delivered via **direct method
 * invocation** — no `postMessage` serialization boundary. This eliminates
 * the race condition where the host sends data before the iframe's module
 * script has booted: messages are buffered and replayed on first
 * `onSlotMessage` subscription.
 *
 * The returned object implements {@link UiPluginHostInternal}, which
 * extends the public {@link UiPluginHost} with `_pushToIframe` and
 * `_onIframeMessage` for host-side renderer use.
 */

import type {
  PluginApiClient,
  UiPluginHostInternal,
  SlotContext,
  SlotHostMessage,
  SlotIframeMessage,
  SlotSession,
} from "@agent-type";
import type { PluginConfigClient } from "./configClient";
import { PluginDescriptor } from "./pluginSystem";


// ── Factory params ────────────────────────────────────────────────────────────

export interface UiPluginHostParams {
  /** Plugin descriptor. */
  readonly plugin: PluginDescriptor;
  /** Pre-bound API client for plugin backend communication. */
  readonly apiClient: PluginApiClient;
  /** Configuration client for plugin settings. */
  readonly configClient: PluginConfigClient;
  /** Active session (for getPluginState). Accepts both main-agent sessions and sub-agent conversations. */
  readonly session?: SlotSession;
  /** Slot context — tells the iframe which slot instance it is rendering. */
  readonly slotContext: SlotContext;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a UiPluginHostInternal for injection into a plugin iframe.
 *
 * The returned object is injected into `iframe.contentWindow.__UAP_PLUGIN_HOST__`.
 * Plugin UI code interacts only with the {@link UiPluginHost} surface;
 * the `_`-prefixed methods are for host-side renderer use.
 */
export function createUiPluginHost(params: UiPluginHostParams): UiPluginHostInternal {
  const { plugin, apiClient, configClient, session, slotContext } = params;

  // ── Host→iframe: subscribers + message buffer ───────────────────────────
  //
  // Messages pushed via `_pushToIframe` before the iframe has registered
  // any `onSlotMessage` subscriber are buffered. When the first subscriber
  // registers, all buffered messages are replayed in order. This eliminates
  // the race where the host sends toolCallInfo before the iframe's module
  // script has executed.

  const iframeSubs = new Set<(msg: SlotHostMessage) => void>();
  const pendingHostToIframe: SlotHostMessage[] = [];

  // ── Iframe→host: subscribers ────────────────────────────────────────────

  const hostSubs = new Set<(msg: SlotIframeMessage) => void>();

  return {
    get apiClient(): PluginApiClient { return apiClient; },
    get pluginId(): string { return plugin.id; },
    get pluginName(): string { return plugin.name; },
    get pluginVersion(): string { return plugin.version; },

    getPluginState() {
      if (!session) return undefined;
      const state = session.getState();
      return [{ ...state }, ...plugin.symbols.map(s => state[s])];
    },

    getSlotContext() { return slotContext; },

    // ── Iframe → Host (plugin UI calls this) ──────────────────────────────

    sendSlotMessage(msg: SlotIframeMessage): void {
      // Deliver directly to host-side subscribers (same-realm, no postMessage).
      hostSubs.forEach((cb) => {
        try { cb(msg); } catch (err) {
          console.warn("[UiPluginHost] Host subscriber error:", err);
        }
      });
    },

    // ── Host → Iframe (plugin UI subscribes to this) ──────────────────────

    onSlotMessage(cb: (msg: SlotHostMessage) => void): () => void {
      iframeSubs.add(cb);

      // Replay any buffered messages on first subscription.
      if (pendingHostToIframe.length > 0) {
        const buffered = pendingHostToIframe.splice(0);
        for (const msg of buffered) {
          try { cb(msg); } catch (err) {
            console.warn("[UiPluginHost] Replay delivery error:", err);
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
          console.warn("[UiPluginHost] Delivery error:", err);
        }
      });
    },

    _onIframeMessage(cb: (msg: SlotIframeMessage) => void): () => void {
      hostSubs.add(cb);
      return () => { hostSubs.delete(cb); };
    },
  };
}
