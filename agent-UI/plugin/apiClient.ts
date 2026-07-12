/**
 * agent-UI/plugin/apiClient.ts — Pre-bound cross-environment plugin API client
 *
 * Provides a PluginApiClient that is pre-bound to a specific plugin id
 * at construction time. Callers never pass `pluginId` — it is injected
 * via closure by the factory.
 *
 * Dual-mode:
 *   - NETWORK (standalone HTTP): POST /api/plugin/<id>/<method> via fetch()
 *   - IPC (Electron): electronAPI.invoke('plugin:<id>:<method>', params)
 *
 * Dependency injection is supported via options.invoke and options.on for
 * testability (R4).  No classes — pure factory function.
 */

import type { PluginApiClient, PluginStreamClient } from '@agent-type';
import { IS_ELECTRON_IPC } from '../env';

// ── Error type ────────────────────────────────────────────────────────────────

export interface PluginApiError {
  readonly pluginId: string;
  readonly method: string;
  readonly status: 'network' | 'ipc' | 'timeout' | 'not-found' | 'internal';
  readonly message: string;
  readonly cause?: unknown;
}

function createPluginApiError(
  pluginId: string,
  method: string,
  status: PluginApiError['status'],
  message: string,
  cause?: unknown,
): PluginApiError {
  return { pluginId, method, status, message, cause };
}

// ── DI options ────────────────────────────────────────────────────────────────

export interface PluginApiClientOptions {
  /**
   * Custom invoke function for IPC mode.
   * When provided, the IPC transport uses this instead of
   * `window.electronAPI.invoke()`.  Useful for testing.
   */
  invoke?: (channel: string, params: Record<string, unknown>) => Promise<unknown>;

  /**
   * Custom event subscription for IPC stream events.
   * When provided, the IPC transport uses this instead of
   * `window.electronAPI.on()`.  Useful for testing.
   */
  on?: (channel: string, cb: (...args: unknown[]) => void) => () => void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a pre-bound PluginApiClient for the given plugin id.
 *
 * The returned client has `call(method, params)` — no `pluginId` parameter,
 * because the id is bound at construction time.
 *
 * Auto-detects the runtime environment (Electron IPC vs standalone HTTP)
 * unless overridden via options.
 *
 * @param pluginId  Plugin id (kebab-case, matches manifest.id).
 * @param options   Optional dependency injection overrides.
 */
export function createPluginApiClient(
  pluginId: string,
  options?: PluginApiClientOptions,
): PluginApiClient {
  const invoke = options?.invoke;
  const on = options?.on;

  if (IS_ELECTRON_IPC || invoke) {
    return createIpcPluginApiClient(pluginId, invoke, on);
  }
  return createHttpPluginApiClient(pluginId);
}

// ── HTTP implementation ───────────────────────────────────────────────────────

function createHttpPluginApiClient(pluginId: string): PluginApiClient {
  const baseUrl = `/api/plugin/${encodeURIComponent(pluginId)}`;

  return {
    async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      const url = `${baseUrl}/${encodeURIComponent(method)}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: params !== undefined ? JSON.stringify(params) : undefined,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw createPluginApiError(pluginId, method, 'network',
            `HTTP ${res.status}: ${text}`, { status: res.status });
        }
        return res.json() as Promise<T>;
      } catch (err) {
        if (isPluginApiError(err)) throw err;
        throw createPluginApiError(pluginId, method, 'network',
          err instanceof Error ? err.message : String(err), err);
      }
    },

    connectStream(streamName: string, params?: Record<string, unknown>): PluginStreamClient {
      // WebSocket URL: ws://host/api/plugin/<id>/<streamName>?key=val&key2=val2
      const queryString = params
        ? Object.entries(params)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&')
        : '';
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}/api/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(streamName)}${queryString ? '?' + queryString : ''}`;

      let ws: WebSocket | null = null;

      const client: PluginStreamClient = {
        callbacks: {
          onData(_chunk) { /* overridden by consumer */ },
          onEnd() { },
          onError(_err) { },
        },
        subscribe: () => {
          ws = new WebSocket(wsUrl);

          ws.onopen = () => { /* ready */ };
          ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
              // Binary frame (JPEG)
              event.data.arrayBuffer().then(buf => client.callbacks.onData(buf));
            } else {
              // JSON message (page info)
              try {
                const obj = JSON.parse(event.data);
                client.callbacks.onData(obj);
              } catch { /* ignore parse errors */ }
            }
          };
          ws.onclose = () => {
            client.callbacks.onEnd();
            ws = null;
          };
          ws.onerror = () => {
            client.callbacks.onError(new Error('WebSocket error'));
          };

          return {
            unsubscribe: () => {
              if (ws) {
                ws.close();
                ws = null;
              }
            },
          };
        },
      };

      return client;
    },
  };
}

// ── IPC implementation ────────────────────────────────────────────────────────

function createIpcPluginApiClient(
  pluginId: string,
  invokeOverride?: (channel: string, params: Record<string, unknown>) => Promise<unknown>,
  onOverride?: (channel: string, cb: (...args: unknown[]) => void) => () => void,
): PluginApiClient {
  const doInvoke: (channel: string, params: Record<string, unknown>) => Promise<unknown> =
    invokeOverride ?? getElectronInvoke();
  const doOn: (channel: string, cb: (...args: unknown[]) => void) => () => void =
    onOverride ?? getElectronOn();

  return {
    async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      const channel = `plugin:${pluginId}:${method}`;
      try {
        const result = await doInvoke(channel, params ?? {});
        return result as T;
      } catch (err) {
        if (isPluginApiError(err)) throw err;

        // Defensive: if the backend plugin failed to activate, no IPC handler
        // was registered, and ipcMain.handle() will throw "No handler registered".
        // Map this to a friendly error instead of a cryptic raw throw.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No handler registered')) {
          throw createPluginApiError(pluginId, method, 'not-found',
            `Plugin "${pluginId}" backend is not active. Method "${method}" has no registered handler. ` +
            `The plugin may have failed to activate on the server.`,
            err);
        }

        throw createPluginApiError(pluginId, method, 'ipc',
          err instanceof Error ? err.message : String(err), err);
      }
    },

    connectStream(streamName: string, params?: Record<string, unknown>): PluginStreamClient {
      const prefix = `plugin:${pluginId}:${streamName}`;
      let resolveConnId: (id: string) => void;
      let rejectConnId: (err: unknown) => void;
      const connIdPromise = new Promise<string>((resolve, reject) => {
        resolveConnId = resolve;
        rejectConnId = reject;
      });
      let cleanupFns: (() => void)[] = [];

      const client: PluginStreamClient = {
        callbacks: {
          onData(_chunk) { /* overridden by consumer */ },
          onEnd() { },
          onError(_err) { },
        },
        subscribe: () => {
          // Listen for data pushed from the backend.
          const unsubFrame = doOn(`${prefix}:frame`, (chunk: unknown) => {
            client.callbacks.onData(chunk);
          });
          const unsubData = doOn(`${prefix}:data`, (chunk: unknown) => {
            client.callbacks.onData(chunk);
          });
          const unsubEnd = doOn(`${prefix}:end`, () => {
            client.callbacks.onEnd();
          });
          cleanupFns = [unsubFrame, unsubData, unsubEnd];

          return {
            unsubscribe: () => {
              cleanupFns.forEach(fn => fn());
              cleanupFns = [];
              // Await connectionId resolution — if the connect call hasn't
              // completed yet, wait for it so the disconnect IPC fires.
              connIdPromise.then((connId) => {
                doInvoke(`${prefix}:disconnect`, { connectionId: connId }).catch(() => {});
              }).catch(() => {});
            },
          };
        },
      };

      // Start the connection asynchronously.
      doInvoke(`${prefix}:connect`, params ?? {}).then((result) => {
        resolveConnId((result as { connectionId: string }).connectionId);
      }).catch((err) => {
        rejectConnId(err);
        client.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      });

      return client;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getElectronInvoke(): (channel: string, params: Record<string, unknown>) => Promise<unknown> {
  const electronAPI = window.electronAPI;
  if (!electronAPI?.invoke) {
    throw new Error(
      '[createPluginApiClient] IPC mode detected but window.electronAPI.invoke is not available. ' +
      'This likely means the preload script is not exposing the expected API.',
    );
  }
  return (channel, params) => electronAPI.invoke(channel, params);
}

function getElectronOn(): (channel: string, cb: (...args: unknown[]) => void) => () => void {
  const electronAPI = window.electronAPI;
  if (!electronAPI?.on) {
    throw new Error(
      '[createPluginApiClient] IPC mode detected but window.electronAPI.on is not available. ' +
      'This likely means the preload script is not exposing the expected API.',
    );
  }
  return (channel, cb) => electronAPI.on(channel, cb);
}

function isPluginApiError(err: unknown): err is PluginApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'pluginId' in err &&
    'method' in err &&
    'status' in err
  );
}
