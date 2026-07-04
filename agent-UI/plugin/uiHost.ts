/**
 * agent-UI/plugin/uiHost.ts — UiPluginHost factory
 *
 * Creates a UiPluginHost instance that is injected into a plugin's
 * iframe sandbox via `iframe.contentWindow.__UAP_PLUGIN_HOST__`.
 *
 * The host provides three communication links:
 *   - **Link A** (`postMessage`): iframe → host (size changes, custom events)
 *   - **Link B** (`onHostMessage`): host → iframe (state updates, config changes)
 *   - **Link C** (`apiClient`): iframe → backend (plugin internal API calls)
 *
 * State delivery (D6): `sessionState` is a direct same-realm reference —
 * NOT serialised via postMessage.  This preserves non-serialisable adapter
 * method references.  postMessage (Link B) sends only lightweight
 * "state changed" notifications; the iframe re-reads `host.sessionState`
 * when notified.
 *
 * No classes — pure factory function.
 */

import type {
  AgentSessionState,
  PluginApiClient,
  UiPluginHost,
  UapPluginMessage,
} from "@agent-type";
import type { PluginConfigClient } from "./configClient";
import { PluginDescriptor } from "./pluginSystem";
import { pick } from "@agent-UI/utils";
import { AgentSession } from "@agent-sdk/client";

// ── Factory params ────────────────────────────────────────────────────────────

export interface UiPluginHostParams {
  /** Plugin identifier (kebab-case, matches manifest.id). */
  readonly plugin: PluginDescriptor;
  /** Pre-bound API client for plugin backend communication (Link C). */
  readonly apiClient: PluginApiClient;
  /** Configuration client for plugin settings. */
  readonly configClient: PluginConfigClient;
  /** Initial state of the plugin. */
  readonly session?: AgentSession;
  /**
   * Function that sends a message from the iframe to the host (Link A).
   * Typically wraps `window.parent.postMessage(msg, targetOrigin)`.
   */
  readonly postMessageSender: (msg: UapPluginMessage) => void;
  readonly subscribe: (cb: (msg: UapPluginMessage) => void) => () => void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a UiPluginHost for the given plugin.
 *
 * The host is a lightweight delegation layer.  It does NOT own the
 * iframe lifecycle — the loader (`createUiPluginSandbox`) manages that.
 *
 * @param params  Factory parameters.
 * @returns       A UiPluginHost instance.
 */
export function createUiPluginHost(params: UiPluginHostParams): UiPluginHost {
  const { plugin, apiClient, configClient, postMessageSender, subscribe, session } =
    params;

  return {
    get sessionState() {
      if (!session) return undefined;
      const state = session.getState();
      debugger
      return state;
    },
    get apiClient(): PluginApiClient {
      return apiClient;
    },

    get pluginId(): string {
      return plugin.id;
    },

    get pluginName(): string {
      return plugin.name;
    },

    get pluginVersion(): string {
      return plugin.version;
    },

    postMessage: postMessageSender,

    onHostMessage: subscribe,

    getConfig<T = unknown>(key: string): T {
      return configClient.getConfig<T>(key);
    },

    onConfigChanged(cb: (config: Record<string, unknown>) => void): () => void {
      return configClient.onConfigChanged(cb);
    },
  };
}
