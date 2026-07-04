/**
 * extensions/browser/agent/pluginAdapter.ts — BrowserPluginAdapter factory
 *
 * Wraps a pre-bound PluginApiClient into the BrowserAdapter interface.
 * This is how the browser plugin's ToolSet communicates with its backend
 * via host.apiClient.call(method, params) — no pluginId needed because
 * the apiClient is pre-bound at construction time.
 *
 * No classes — pure factory function.
 */

import type { BrowserAdapter, BrowserEntry, BrowserOutput, BrowserNavigateResult, BrowserSnapshotResult, BrowserWaitResult, BrowserLaunchConfig, BrowserStreamConnection, BrowserStreamCallbacks, NetworkQueryOptions, NetworkQueryResult } from './types';
import type { StreamConfig } from './streamConfig';
import type { PluginApiClient } from '@agent-type';
import { toArrayBuffer } from './toArrayBuffer';

/**
 * Creates a BrowserAdapter that delegates all calls to a backend plugin
 * via a pre-bound PluginApiClient.
 *
 * The apiClient's pluginId is already bound — callers only pass method + params.
 *
 * @param apiClient  A pre-bound PluginApiClient for the 'browser' plugin.
 * @returns          A BrowserAdapter implementation.
 */
export function createBrowserPluginAdapter(apiClient: PluginApiClient): BrowserAdapter {
  return {
    async listSessions(opts) {
      return apiClient.call<{ sessions: BrowserEntry[] }>('listSessions', opts as Record<string, unknown>)
        .then(r => r.sessions);
    },

    async createSession(opts) {
      return apiClient.call<BrowserEntry>('createSession', opts as Record<string, unknown>);
    },

    async closeSession(id, sessionId) {
      await apiClient.call('closeSession', { id, sessionId });
    },

    async navigate(id, url, opts) {
      return apiClient.call<BrowserNavigateResult>('navigate', { id, url, ...opts });
    },

    async evaluate(id, script, sessionId) {
      const raw = await apiClient.call<{ result: unknown }>('evaluate', { id, script, sessionId });
      return raw.result;
    },

    async readOutput(id, fromOffset, sessionId) {
      return apiClient.call<BrowserOutput>('readOutput', { id, fromOffset, sessionId });
    },

    async snapshot(id, sessionId) {
      return apiClient.call<BrowserSnapshotResult>('snapshot', { id, sessionId });
    },

    async wait(id, opts) {
      return apiClient.call<BrowserWaitResult>('wait', { id, ...opts });
    },

    async setLaunchConfig(id, config, sessionId) {
      return apiClient.call<BrowserEntry>('setLaunchConfig', { id, config, sessionId });
    },

    async setProxy(id, useProxy, sessionId) {
      return apiClient.call<BrowserEntry>('setProxy', { id, useProxy, sessionId });
    },

    async switchTab(id, index, sessionId) {
      return apiClient.call<BrowserEntry>('switchTab', { id, index, sessionId });
    },

    async setViewportSize(id, width, height, sessionId) {
      return apiClient.call<BrowserEntry>('setViewportSize', { id, width, height, sessionId });
    },

    async screenshotData(id, sessionId, selector?) {
      return apiClient.call<{ data: string; mimeType: string }>('screenshotData', { id, sessionId, selector });
    },

    async getNetworkRequests(id, opts) {
      return apiClient.call<NetworkQueryResult>('getNetworkRequests', { id, ...opts });
    },

    async clearNetworkRequests(id, opts) {
      await apiClient.call('clearNetworkRequests', { id, ...opts });
    },

    connectStream(id: string, callbacks: BrowserStreamCallbacks, config?: StreamConfig): BrowserStreamConnection {
      // Establish a bidirectional stream connection via the plugin API client.
      // The transport layer (IPC or HTTP/WS) is fully encapsulated — this code
      // only uses the abstract PluginApiClient interface.
      const stream = apiClient.connectStream('browserStream', { id, config });

      let connected = false;

      // Bridge: backend pushes frames/messages → BrowserLiveView callbacks.
      stream.callbacks.onData = (chunk: unknown) => {
        if (!connected) {
          connected = true;
          callbacks.onStateChange(true);
        }
        const ab = toArrayBuffer(chunk);
        if (ab) {
          callbacks.onFrame(ab);
        } else if (typeof chunk === 'object' && chunk !== null) {
          callbacks.onMessage(chunk as Parameters<BrowserStreamCallbacks['onMessage']>[0]);
        }
      };
      stream.callbacks.onEnd = () => callbacks.onStateChange(false);
      stream.callbacks.onError = () => callbacks.onStateChange(false);

      // Start the stream.
      const sub = stream.subscribe();

      return {
        send(event) {
          // Send input events via the standard defineApi path.
          apiClient.call('dispatchInput', { id, event }).catch(() => {});
        },
        close() {
          sub.unsubscribe();
          callbacks.onStateChange(false);
        },
        updateConfig(partialConfig: Partial<StreamConfig>) {
          apiClient.call('updateStreamConfig', { id, config: partialConfig }).catch(() => {});
        },
      };
    },
  };
}
