/**
 * internal-plugins/browser/agent/pluginAdapter.ts — BrowserPluginAdapter factory
 *
 * Wraps a pre-bound PluginApiClient into the BrowserAdapter interface.
 * This adapter is used by BOTH the agent-side ToolSet and the UI-side iframe.
 *
 * sessionId parameters have been removed from the interface — the backend
 * ignores them (all sessions share a single chromium pool).
 *
 * No classes — pure factory function.
 */

import type {
  BrowserAdapter,
  BrowserEntry,
  BrowserOutput,
  BrowserNavigateResult,
  BrowserSnapshotResult,
  BrowserWaitResult,
  BrowserLaunchConfig,
  BrowserStreamConnection,
  BrowserStreamCallbacks,
  NetworkQueryOptions,
  NetworkQueryResult,
} from './types';
import type { StreamConfig } from './streamConfig';
import type { PluginApiClient } from '@agent-type';
import { toArrayBuffer } from './toArrayBuffer';

/**
 * Creates a BrowserAdapter that delegates all calls to a backend plugin
 * via a pre-bound PluginApiClient.
 *
 * @param apiClient  A pre-bound PluginApiClient for the 'browser' plugin.
 * @returns          A BrowserAdapter implementation.
 */
export function createBrowserPluginAdapter(apiClient: PluginApiClient): BrowserAdapter {
  return {
    async listSessions(opts) {
      return apiClient
        .call<{ sessions: BrowserEntry[] }>('listSessions', (opts ?? {}) as Record<string, unknown>)
        .then((r) => r.sessions);
    },

    async createSession(opts) {
      return apiClient.call<BrowserEntry>('createSession', opts as Record<string, unknown>);
    },

    async closeSession(id) {
      await apiClient.call('closeSession', { id });
    },

    async navigate(id, url, opts) {
      return apiClient.call<BrowserNavigateResult>('navigate', { id, url, ...(opts ?? {}) });
    },

    async evaluate(id, script) {
      const raw = await apiClient.call<{ result: unknown }>('evaluate', { id, script });
      return raw.result;
    },

    async readOutput(id, fromOffset) {
      return apiClient.call<BrowserOutput>('readOutput', { id, fromOffset });
    },

    async snapshot(id) {
      return apiClient.call<BrowserSnapshotResult>('snapshot', { id });
    },

    async wait(id, opts) {
      return apiClient.call<BrowserWaitResult>('wait', { id, ...(opts ?? {}) });
    },

    async setLaunchConfig(id, config) {
      return apiClient.call<BrowserEntry>('setLaunchConfig', { id, config });
    },

    async setProxy(id, useProxy) {
      return apiClient.call<BrowserEntry>('setProxy', { id, useProxy });
    },

    async switchTab(id, index) {
      return apiClient.call<BrowserEntry>('switchTab', { id, index });
    },

    async setViewportSize(id, width, height) {
      return apiClient.call<BrowserEntry>('setViewportSize', { id, width, height });
    },

    async screenshotData(id, selector?) {
      return apiClient.call<{ data: string; mimeType: string }>('screenshotData', { id, selector });
    },

    async getNetworkRequests(id, opts) {
      return apiClient.call<NetworkQueryResult>('getNetworkRequests', { id, ...(opts ?? {}) });
    },

    async clearNetworkRequests(id, opts) {
      await apiClient.call('clearNetworkRequests', { id, ...(opts ?? {}) });
    },

    connectStream(
      id: string,
      callbacks: BrowserStreamCallbacks,
      config?: StreamConfig,
    ): BrowserStreamConnection {
      const client = apiClient.connectStream('browserStream', { id, config });

      let connected = false;

      client.callbacks.onData = (chunk: unknown) => {
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
      client.callbacks.onEnd = () => callbacks.onStateChange(false);
      client.callbacks.onError = () => callbacks.onStateChange(false);

      const sub = client.subscribe();

      return {
        send(event) {
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

/** Alias — UI iframe uses the same factory, described by a friendlier name. */
export const createBrowserUiAdapter = createBrowserPluginAdapter;
