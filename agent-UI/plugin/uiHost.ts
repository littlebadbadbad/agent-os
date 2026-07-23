import type {
  PluginApiClient,
  UiPluginHostInternal,
  SlotContext,
  SlotHostMessage,
  SlotSession,
  PluginBridge,
} from "@agent-type";
import type { PluginConfigClient } from "./configClient";
import { PluginDescriptor } from "./pluginTypes";


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
  /** The ToolSet symbol whose state to expose via `getPluginState()`. */
  readonly toolSetSymbol: symbol;
  /**
   * Shared bridge object — same reference as {@link AgentPluginHost.bridge}.
   * Agent writes methods/properties during activation;
   * UI reads/calls them directly.
   */
  readonly bridge: PluginBridge;
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
  const { plugin, apiClient, configClient, session, slotContext, toolSetSymbol, bridge } = params;

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
    get apiClient(): PluginApiClient { return apiClient; },
    get pluginId(): string { return plugin.id; },
    get pluginName(): string { return plugin.name; },
    get pluginVersion(): string { return plugin.version; },
    get bridge(): PluginBridge { return bridge; },

    getPluginState() {
      if (!session) return undefined;
      const state = session.getState();
      const toolSetState = state[toolSetSymbol];
      if (!toolSetState) return undefined;
      return [{ ...state }, toolSetState];
    },

    getSlotContext() { return slotContext; },

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
  };
}
