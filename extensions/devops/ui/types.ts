/**
 * extensions/devops/agent/types.ts — DevOps plugin type definitions
 *
 * Three-layer contract:
 *   1. DevOpsAdapter wraps PluginApiClient for backend communication
 *   2. DevOpsBridge is the shared object between agent and UI layers
 *   3. UiBridgeHandlerRegistry lets UI register handlers that tools call
 */

import type { PluginBridge, PluginStateExtension, UiPluginHost } from '@agent-type';

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost<PluginStateExtension, DevOpsBridge>;
  }
}
// ── Backend adapter ───────────────────────────────────────────────────────────

/**
 * Adapter that wraps PluginApiClient for the DevOps backend service.
 * Agent tools never call apiClient directly — they go through this adapter.
 */
export interface DevOpsAdapter {
  /** Forward a JSON-envelope request to the ADO REST API via backend. */
  callAdoProxy<T>(params: AdoProxyCallParams): Promise<T>;
  /** Upload raw binary data to ADO (file attachments, etc.). */
  uploadAdoProxy<T>(params: AdoProxyUploadParams): Promise<T>;
  /** Fetch the server's RSA public key for PAT encryption. */
  getPublicKey(): Promise<PublicKeyInfo>;
}

// ── Bridge (shared between agent ↔ UI) ────────────────────────────────────────

/**
 * Handler type compatible with the UiBridge implementation.
 * The bridge uses a Map<string, Function> internally — no type-level
 * enforcement exists across the string key, so callers must ensure
 * handler signatures match at registration sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => any;

/**
 * Bridge interface — populated by the UI layer, consumed by agent tools.
 *
 * The UI creates a UiBridge instance and assigns its methods to this
 * shared object via `Object.assign(host.bridge, { ... })`. Agent tools
 * capture the bridge reference in their closure and call through it.
 */
export interface DevOpsBridge extends PluginBridge {
  /** Call a UI-registered handler asynchronously. */
  callHandler<T>(key: string, ...args: unknown[]): Promise<T>;
  /** Read a UI state snapshot synchronously. */
  snapshot<T>(key: string): T;
  /** Check whether a handler is currently registered. */
  isRegistered(key: string): boolean;
  /** Poll until predicate returns true (used after dispatching async UI actions). */
  waitUntil(predicate: () => boolean, timeoutMs?: number, intervalMs?: number): Promise<void>;
  /** Register a handler (called by UI components on mount). */
  registerHandler(key: string, handler: Handler): void;
  /** Unregister a handler (called by UI components on unmount). */
  unregisterHandler(key: string): void;
}

// ── ADO proxy parameter types ────────────────────────────────────────────────

export interface AdoProxyCallParams {
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
  rawBody: unknown;
}

export interface PublicKeyInfo {
  key: string;
}
