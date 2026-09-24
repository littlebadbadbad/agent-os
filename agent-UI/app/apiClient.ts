/**
 * agent-UI/app/apiClient.ts — Pre-bound cross-environment app API client
 *
 * Provides a AppApiClient that is pre-bound to a specific app id
 * at construction time. Callers never pass `appId` — it is injected
 * via closure by the factory.
 *
 * Dual-mode:
 *   - NETWORK (standalone HTTP): POST /api/app/<id>/<method> via fetch()
 *   - IPC (Electron): electronAPI.invoke('app:<id>:<method>', params)
 *
 * Dependency injection is supported via options.invoke and options.on for
 * testability (R4).  No classes — pure factory function.
 */

import type { AppApiClient, AppStreamClient } from '@agent-type';
import { IS_DEBUG, IS_ELECTRON_IPC } from '../env';
import { withNetRecording } from './netLogClient';

// ── Error type ────────────────────────────────────────────────────────────────

export interface AppApiError {
  readonly appId: string;
  readonly method: string;
  readonly status: 'network' | 'ipc' | 'timeout' | 'not-found' | 'internal';
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Error class that extends `Error` so it flows correctly through catch blocks
 * that test `err instanceof Error`, while carrying structured app API metadata
 * (appId, method, status) for programmatic handling.
 *
 * No classes in the public API — internal implementation detail.
 */
class AppApiErrorImpl extends Error implements AppApiError {
  readonly appId: string;
  readonly method: string;
  readonly status: AppApiError['status'];
  readonly cause?: unknown;

  constructor(
    appId: string,
    method: string,
    status: AppApiError['status'],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AppApiError';
    this.appId = appId;
    this.method = method;
    this.status = status;
    this.cause = cause;
  }
}

function createAppApiError(
  appId: string,
  method: string,
  status: AppApiError['status'],
  message: string,
  cause?: unknown,
): AppApiError {
  return new AppApiErrorImpl(appId, method, status, message, cause);
}

// ── DI options ────────────────────────────────────────────────────────────────

export interface AppApiClientOptions {
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
 * Create a pre-bound AppApiClient for the given app id.
 *
 * The returned client has `call(method, params)` — no `appId` parameter,
 * because the id is bound at construction time.
 *
 * Auto-detects the runtime environment (Electron IPC vs standalone HTTP)
 * unless overridden via options.
 *
 * @param appId  App id (kebab-case, matches manifest.id).
 * @param options   Optional dependency injection overrides.
 */
export function createAppApiClient(
  appId: string,
  options?: AppApiClientOptions,
): AppApiClient {
  const invoke = options?.invoke;
  const on = options?.on;

  const client =
    IS_ELECTRON_IPC || invoke
      ? createIpcAppApiClient(appId, invoke, on)
      : createHttpAppApiClient(appId);

  // In debug builds, mirror all call()/connectStream() traffic into the
  // network recorder so the debug panel can inspect it. Zero-cost otherwise.
  return IS_DEBUG ? withNetRecording(client, appId) : client;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

function createHttpAppApiClient(appId: string): AppApiClient {
  const baseUrl = `/api/app/${encodeURIComponent(appId)}`;

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
          throw createAppApiError(appId, method, 'network',
            `HTTP ${res.status}: ${text}`, { status: res.status });
        }
        return res.json() as Promise<T>;
      } catch (err) {
        if (isAppApiError(err)) throw err;
        throw createAppApiError(appId, method, 'network',
          err instanceof Error ? err.message : String(err), err);
      }
    },

    connectStream(streamName: string, params?: Record<string, unknown>): AppStreamClient {
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
      const wsUrl = `${protocol}//${location.host}/api/app/${encodeURIComponent(appId)}/${encodeURIComponent(streamName)}${queryString ? '?' + queryString : ''}`;

      // ── State shared between subscribe/unsubscribe and async WS events ──
      let subscribed = false;

      const client: AppStreamClient = {
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

function createIpcAppApiClient(
  appId: string,
  invokeOverride?: (channel: string, params: Record<string, unknown>) => Promise<unknown>,
  onOverride?: (channel: string, cb: (...args: unknown[]) => void) => () => void,
): AppApiClient {
  const doInvoke: (channel: string, params: Record<string, unknown>) => Promise<unknown> =
    invokeOverride ?? getElectronInvoke();
  const doOn: (channel: string, cb: (...args: unknown[]) => void) => () => void =
    onOverride ?? getElectronOn();

  return {
    async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      const channel = `app:${appId}:${method}`;
      try {
        const result = await doInvoke(channel, params ?? {});
        return result as T;
      } catch (err) {
        if (isAppApiError(err)) throw err;

        // Defensive: if the backend app failed to activate, no IPC handler
        // was registered, and ipcMain.handle() will throw "No handler registered".
        // Map this to a friendly error instead of a cryptic raw throw.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('No handler registered')) {
          throw createAppApiError(appId, method, 'not-found',
            `App "${appId}" backend is not active. Method "${method}" has no registered handler. ` +
            `The app may have failed to activate on the server.`,
            err);
        }

        throw createAppApiError(appId, method, 'ipc',
          err instanceof Error ? err.message : String(err), err);
      }
    },

    connectStream(streamName: string, params?: Record<string, unknown>): AppStreamClient {
      const prefix = `app:${appId}:${streamName}`;

      // ── State shared between subscribe/unsubscribe and the async connect ──
      let connId: string | null = null;
      let cancelled = false;
      const cleanupFns: (() => void)[] = [];

      const client: AppStreamClient = {
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
          //    Listen on :data (JSON) for text/control messages.
          const unsubData = doOn(`${prefix}:data`, (chunk: unknown) => {
            client.callbacks.onData(chunk);
          });
          cleanupFns.push(unsubData);

          //    Listen on :frame (binary) for binary payloads (JPEG frames, etc.).
          //    Node.js Buffer crosses Electron IPC as Uint8Array via structured clone.
          const unsubFrame = doOn(`${prefix}:frame`, (chunk: unknown) => {
            if (chunk instanceof Uint8Array) {
              const view = new Uint8Array(chunk);
              client.callbacks.onData(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
            } else if (chunk instanceof ArrayBuffer) {
              client.callbacks.onData(chunk);
            } else {
              client.callbacks.onData(chunk);
            }
          });
          cleanupFns.push(unsubFrame);

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
      '[createAppApiClient] IPC mode detected but window.electronAPI.invoke is not available. ' +
      'This likely means the preload script is not exposing the expected API.',
    );
  }
  return (channel, params) => electronAPI.invoke(channel, params);
}

function getElectronOn(): (channel: string, cb: (...args: unknown[]) => void) => () => void {
  const electronAPI = window.electronAPI;
  if (!electronAPI?.on) {
    throw new Error(
      '[createAppApiClient] IPC mode detected but window.electronAPI.on is not available. ' +
      'This likely means the preload script is not exposing the expected API.',
    );
  }
  return (channel, cb) => electronAPI.on(channel, cb);
}

function isAppApiError(err: unknown): err is AppApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'appId' in err &&
    'method' in err &&
    'status' in err
  );
}
