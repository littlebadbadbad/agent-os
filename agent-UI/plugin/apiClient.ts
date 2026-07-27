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

/**
 * Error class that extends `Error` so it flows correctly through catch blocks
 * that test `err instanceof Error`, while carrying structured plugin API metadata
 * (pluginId, method, status) for programmatic handling.
 *
 * No classes in the public API — internal implementation detail.
 */
class PluginApiErrorImpl extends Error implements PluginApiError {
  readonly pluginId: string;
  readonly method: string;
  readonly status: PluginApiError['status'];
  readonly cause?: unknown;

  constructor(
    pluginId: string,
    method: string,
    status: PluginApiError['status'],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'PluginApiError';
    this.pluginId = pluginId;
    this.method = method;
    this.status = status;
    this.cause = cause;
  }
}

function createPluginApiError(
  pluginId: string,
  method: string,
  status: PluginApiError['status'],
  message: string,
  cause?: unknown,
): PluginApiError {
  return new PluginApiErrorImpl(pluginId, method, status, message, cause);
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
      // Build WebSocket URL with query params.
      const queryString = params
        ? Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'function' && typeof v !== 'symbol')
            .map(([k, v]) => {
              const encoded = typeof v === 'object'
                ? encodeURIComponent(JSON.stringify(v))
                : encodeURIComponent(String(v));
              return `${encodeURIComponent(k)}=${encoded}`;
            })
            .join('&')
        : '';
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}/api/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(streamName)}${queryString ? '?' + queryString : ''}`;

      // ── State shared between subscribe/unsubscribe and async WS events ──
      let subscribed = false;

      const client: PluginStreamClient = {
        callbacks: {
          onData(_chunk) { /* overridden by consumer */ },
          onEnd() { },
          onError(_err) { },
        },
        subscribe: () => {
          // Guard: reject duplicate subscribe calls (StrictMode safety)
          if (subscribed) {
            return { unsubscribe: () => {} };
          }

          subscribed = true;
          const ws = new WebSocket(wsUrl);

          ws.onopen = () => { /* ready — connection established */ };
          ws.onmessage = (event) => {
            // If unsubscribed before this event arrived, drop it.
            if (!subscribed) return;

            if (event.data instanceof Blob) {
              event.data.arrayBuffer().then(buf => {
                if (subscribed) client.callbacks.onData(buf);
              });
            } else {
              try {
                const obj = JSON.parse(event.data);
                if (subscribed) client.callbacks.onData(obj);
              } catch { /* ignore parse errors */ }
            }
          };
          ws.onclose = () => {
            // WebSocket always fires onclose after onerror, so guard against
            // the double-fire with the subscribed flag.
            if (!subscribed) return;
            subscribed = false;
            client.callbacks.onEnd();
          };
          ws.onerror = () => {
            // WebSocket fires onclose immediately after onerror per spec,
            // so onError is raised here and onEnd is raised in onclose.
            // No risk of double-fire because subscribed guards onclose.
            if (subscribed) {
              client.callbacks.onError(new Error('WebSocket error'));
            }
          };

          return {
            unsubscribe: () => {
              if (!subscribed) return;
              subscribed = false;
              // close() triggers onclose synchronously in most runtimes,
              // but the subscribed=false guard prevents onclose from calling
              // onEnd a second time.
              ws.close();
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

      // ── State shared between subscribe/unsubscribe and the async connect ──
      let connId: string | null = null;
      let cancelled = false;
      const cleanupFns: (() => void)[] = [];

      const client: PluginStreamClient = {
        callbacks: {
          onData(_chunk) { /* overridden by consumer */ },
          onEnd() { },
          onError(_err) { },
        },

        subscribe: () => {
          // Guard: reject duplicate subscribe calls
          if (cleanupFns.length > 0) {
            return { unsubscribe: () => {} };
          }

          // 1. Register IPC listeners FIRST — before connect, so no data is lost.
          //    Only listen on :data (JSON) — the terminal plugin uses sendJSON exclusively.
          //    The :frame (binary) channel is for other plugin types (e.g. browser screenshots).
          const unsubData = doOn(`${prefix}:data`, (chunk: unknown) => {
            client.callbacks.onData(chunk);
          });
          cleanupFns.push(unsubData);

          const unsubEnd = doOn(`${prefix}:end`, () => {
            client.callbacks.onEnd();
          });
          cleanupFns.push(unsubEnd);

          // 2. Start the connection. IPC listeners are already registered, so
          //    any data the backend pushes on :data will be delivered immediately.
          doInvoke(`${prefix}:connect`, params ?? {}).then((result) => {
            const record: Record<string, unknown> = Object.assign(Object.create(null), result);
            const resolvedConnId = record.connectionId;
            if (typeof resolvedConnId !== 'string') {
              throw new Error('Connect response missing connectionId');
            }

            if (cancelled) {
              // Unsubscribe was called before connect resolved — tear down immediately.
              doInvoke(`${prefix}:disconnect`, { connectionId: resolvedConnId }).catch(() => {});
              return;
            }

            connId = resolvedConnId;
          }).catch((err) => {
            // If cancelled, suppress error — the disconnect path already handles cleanup.
            if (!cancelled) {
              client.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
            }
          });

          return {
            unsubscribe: () => {
              cancelled = true;

              // Remove IPC listeners first — no more callbacks will fire.
              for (const fn of cleanupFns) {
                try { fn(); } catch {}
              }
              cleanupFns.length = 0;

              // Then disconnect the backend connection (may still be in-flight).
              if (connId) {
                const id = connId;
                connId = null;
                doInvoke(`${prefix}:disconnect`, { connectionId: id }).catch(() => {});
              }
            },
          };
        },
      };

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
