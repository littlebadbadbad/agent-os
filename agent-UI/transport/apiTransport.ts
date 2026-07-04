/**
 * agent-UI/transport/apiTransport.ts — Generic API communication transport
 *
 * PURE COMMUNICATION LAYER — ZERO business logic.
 *
 * Provides a clean abstraction for REST-like API calls with two backends:
 *   - HttpApiTransport: uses HTTP fetch (standalone HTTP mode)
 *   - IpcApiTransport:  uses Electron IPC (electron-ipc mode)
 *
 * The factory function `createApiTransport()` selects the right one
 * based on the runtime environment, so consumers never need to know
 * which transport is active.
 *
 * The routing between URL-style paths (used by business-logic modules)
 * and IPC channel names is defined in a central route table inside
 * IpcApiTransport, keeping the mapping explicit and easy to audit.
 */

import { BACKEND_URL } from '../config';
import { IS_ELECTRON_IPC } from '../env';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdoProxyParams {
  url: string;
  pat: string;
  method: string;
  body?: unknown;
  contentType?: string;
  apiVersion?: string;
}

export interface AdoProxyUploadParams {
  url: string;
  pat: string;
  contentType: string;
  apiVersion: string;
  rawBody: BodyInit;
}

export interface ApiTransport {
  /** GET a JSON resource. */
  get<T = unknown>(path: string, signal?: AbortSignal): Promise<T>;

  /** POST JSON body, receive JSON response. */
  post<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** PUT JSON body, receive JSON response. */
  put<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** DELETE a resource. */
  del(path: string): Promise<void>;

  /** ADO proxy: standard JSON request. */
  adoProxy<T = unknown>(params: AdoProxyParams): Promise<T>;

  /** ADO proxy: binary upload. */
  adoProxyUpload<T = unknown>(params: AdoProxyUploadParams): Promise<T>;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${BACKEND_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

function createHttpApiTransport(): ApiTransport {
  return {
    async get<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
      const res = await fetch(buildUrl(path), { signal });
      if (!res.ok) {
        throw new Error(`HTTP GET ${path} → ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<T>;
    },

    async post<T = unknown>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(buildUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP POST ${path} → ${res.status}: ${text}`);
      }
      return res.json() as Promise<T>;
    },

    async put<T = unknown>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(buildUrl(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP PUT ${path} → ${res.status}: ${text}`);
      }
      return res.json() as Promise<T>;
    },

    async del(path: string): Promise<void> {
      const res = await fetch(buildUrl(path), { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`HTTP DELETE ${path} → ${res.status}: ${res.statusText}`);
      }
    },

    async adoProxy<T = unknown>(params: AdoProxyParams): Promise<T> {
      const { url, pat, method, body, contentType, apiVersion } = params;
      const headers: Record<string, string> = {
        'Content-Type': contentType ?? 'application/json',
        'X-ADO-PAT': pat,
      };
      if (apiVersion) headers['X-ADO-API-Version'] = apiVersion;
      const res = await fetch(buildUrl('/api/ado-proxy'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ url, method, body }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`ADO proxy error (HTTP ${res.status}): ${text}`);
      }
      return res.json() as Promise<T>;
    },

    async adoProxyUpload<T = unknown>(params: AdoProxyUploadParams): Promise<T> {
      const { url, pat, contentType, apiVersion, rawBody } = params;
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'X-ADO-PAT': pat,
        'X-ADO-API-Version': apiVersion,
      };
      const res = await fetch(buildUrl('/api/ado-proxy/upload'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ url, rawBody }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`ADO proxy upload error (HTTP ${res.status}): ${text}`);
      }
      return res.json() as Promise<T>;
    },
  };
}

// ── IPC implementation ─────────────────────────────────────────────────────────
// Used when running inside Electron.  All API calls go through
// window.electronAPI.invoke() with a channel name derived from the URL path.

/** Guard: is the value a non-null object (not array, not null)? */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── IPC route entry ───────────────────────────────────────────────────────────

type IpcRouteEntry = {
  /** HTTP method (GET / POST / PUT / DELETE). */
  readonly method: string;
  /** URL path pattern. Exact match when `exact: true`, otherwise prefix match. */
  readonly pattern: string;
  /** `true` for exact URL match; `false` for prefix-based wildcard matching. */
  readonly exact: boolean;
  /** IPC channel name to invoke on the backend. */
  readonly channel: string;
  /**
   * Transform the URL path + optional request body into the business params
   * expected by the backend IPC handler.
   *
   * When omitted, the raw body (for POST/PUT) or an empty object (for GET/DEL)
   * is sent directly — suitable when the route carries no URL-encoded params.
   */
  readonly toParams?: (path: string, body?: unknown) => Record<string, unknown>;
};

function createIpcApiTransport(): ApiTransport {
  // Route table: ordered entries — exact matches first, prefix matches after.
  // Each entry maps a REST-like URL pattern to an IPC channel and provides a
  // `toParams` transform so backend handlers receive the correct business
  // parameters (e.g. `{ agentId }` for session-load) instead of raw URL parts.
  const ROUTES: IpcRouteEntry[] = [
    // ── Health ─────────────────────────────────────────────────────────────
    { method: 'GET',    pattern: '/api/health',                exact: true,  channel: 'health:check' },
    // ── Public key ─────────────────────────────────────────────────────────
    { method: 'GET',    pattern: '/api/public-key',            exact: true,  channel: 'publicKey:get' },
    // ── Skills ─────────────────────────────────────────────────────────────
    { method: 'GET',    pattern: '/api/skills',                exact: true,  channel: 'skills:list' },
    // ── Proxy ──────────────────────────────────────────────────────────────
    { method: 'GET',    pattern: '/api/proxy',                 exact: true,  channel: 'api:proxy:get' },
    { method: 'PUT',    pattern: '/api/proxy',                 exact: true,  channel: 'api:proxy:update',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    // ── Models (query string carries provider name) ────────────────────────
    { method: 'GET',    pattern: '/api/models',                exact: true,  channel: 'api:models:list',
      toParams: (path) => {
        const qs = new URL(path, 'http://localhost').searchParams;
        return Object.fromEntries(qs.entries());
      }},
    // ── Model config (built-in + custom merge) ────────────────────────────
    { method: 'GET',    pattern: '/api/model-config',          exact: true,  channel: 'api:model-config:get' },
    { method: 'GET',    pattern: '/api/model-config/built-in', exact: true,  channel: 'api:model-config:built-in' },
    { method: 'GET',    pattern: '/api/model-config/custom',   exact: true,  channel: 'api:model-config:custom:get' },
    { method: 'PUT',    pattern: '/api/model-config/custom',   exact: true,  channel: 'api:model-config:custom:save',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    { method: 'POST',   pattern: '/api/model-config/custom/add',    exact: true,  channel: 'api:model-config:custom:add',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    { method: 'POST',   pattern: '/api/model-config/custom/remove', exact: true,  channel: 'api:model-config:custom:remove',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    { method: 'POST',   pattern: '/api/model-config/custom/update', exact: true,  channel: 'api:model-config:custom:update',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    // ── API keys ───────────────────────────────────────────────────────────
    { method: 'GET',    pattern: '/api/api-keys',              exact: true,  channel: 'api:api-keys:list' },
    { method: 'POST',   pattern: '/api/api-keys',              exact: true,  channel: 'api:api-keys:save',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    { method: 'DELETE', pattern: '/api/api-keys/',             exact: false, channel: 'api:api-keys:delete',
      toParams: (path) => ({ providerId: decodeURIComponent(path.split('/').pop()!) }) },
    // ── Session persistence ────────────────────────────────────────────────
    { method: 'GET',    pattern: '/api/agent-sessions/',       exact: false, channel: 'sessions:load',
      toParams: (path) => ({ agentId: decodeURIComponent(path.split('/').pop()!) }) },
    { method: 'PUT',    pattern: '/api/agent-sessions/',       exact: false, channel: 'sessions:save',
      toParams: (path, body) => ({
        agentId: decodeURIComponent(path.split('/').pop()!),
        ...(isRecord(body) ? body : {}),
      })},
    // ── ADO proxy ──────────────────────────────────────────────────────────
    { method: 'POST',   pattern: '/api/ado-proxy',             exact: true,  channel: 'api:ado-proxy:call',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
    { method: 'POST',   pattern: '/api/ado-proxy/upload',     exact: true,  channel: 'api:ado-proxy:upload',
      toParams: (_path, body) => (body as Record<string, unknown>) ?? {} },
  ];

  const electronAPI = (window as any).electronAPI;

  function matchRoute(method: string, rawPath: string): IpcRouteEntry {
    // Strip query string before matching so `/api/models?provider=doubao`
    // matches the exact entry for `/api/models`.
    const path = rawPath.includes('?') ? rawPath.slice(0, rawPath.indexOf('?')) : rawPath;

    // Exact matches first
    for (const entry of ROUTES) {
      if (entry.method !== method) continue;
      if (entry.exact && path === entry.pattern) return entry;
    }
    // Prefix (wildcard) matches
    for (const entry of ROUTES) {
      if (entry.method !== method) continue;
      if (!entry.exact && path.startsWith(entry.pattern)) return entry;
    }
    throw new Error(`[IpcApiTransport] No route for ${method} ${rawPath}`);
  }

  return {
    async get<T>(path: string, _signal?: AbortSignal): Promise<T> {
      const entry = matchRoute('GET', path);
      const params = entry.toParams?.(path) ?? {};
      return electronAPI.invoke(entry.channel, params) as Promise<T>;
    },

    async post<T>(path: string, body?: unknown): Promise<T> {
      const entry = matchRoute('POST', path);
      const params = entry.toParams?.(path, body) ?? {};
      return electronAPI.invoke(entry.channel, params) as Promise<T>;
    },

    async put<T>(path: string, body?: unknown): Promise<T> {
      const entry = matchRoute('PUT', path);
      const params = entry.toParams?.(path, body) ?? {};
      return electronAPI.invoke(entry.channel, params) as Promise<T>;
    },

    async del(path: string): Promise<void> {
      const entry = matchRoute('DELETE', path);
      const params = entry.toParams?.(path) ?? {};
      await electronAPI.invoke(entry.channel, params);
    },

    async adoProxy<T>(params: AdoProxyParams): Promise<T> {
      return electronAPI.invoke('api:ado-proxy:call', params) as Promise<T>;
    },

    async adoProxyUpload<T>(params: AdoProxyUploadParams): Promise<T> {
      return electronAPI.invoke('api:ado-proxy:upload', params) as Promise<T>;
    },
  };
}

// ── Singleton ──────────────────────────────────────────────────────────────────

export const apiTransport: ApiTransport = IS_ELECTRON_IPC
  ? createIpcApiTransport()
  : createHttpApiTransport();
