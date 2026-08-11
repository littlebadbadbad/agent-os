/**
 * backend/lib/app-router.js — Central routing registry for backend apps.
 *
 * Apps register API methods and stream handlers via their BackendAppHost.
 * The router aggregates all registrations and exposes match functions used by
 * the HTTP server, IPC layer, and WebSocket upgrade handler.
 *
 * Routing protocol (keep in sync with the type contract):
 *   HTTP  → POST /api/app/<appId>/<method>
 *   IPC   → app:<appId>:<method>
 *   WS    → /api/app/<appId>/<streamName>
 *
 * Usage:
 *   import { appRouter } from './app-router.js';
 *   appRouter.registerApi('browser', 'greet', async (params) => `hello ${params.name}`);
 */

import { createLogger } from './logger.js';

/** @import { StreamConnection } from '../../agent-type/app.ts' */

const log = createLogger('app-router');

// ── Internal state ───────────────────────────────────────────────────────────

/**
 * Map key → handler.
 * Key format: "<appId>:<methodName>" for API methods.
 * @type {Map<string, (params: Record<string, unknown>) => Promise<unknown>>}
 */
const _methods = new Map();

/**
 * Map key → stream handler factory.
 * Key format: "<appId>:<streamName>" for streams.
 * @type {Map<string, () => StreamConnection>}
 */
const _streams = new Map();

/**
 * Track which methods/streams belong to each app for bulk unregistration.
 * @type {Map<string, { methods: Set<string>, streams: Set<string> }>}
 */
const _appIndex = new Map();

// ── Public API ───────────────────────────────────────────────────────────────

export const appRouter = {
  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register an API method for a app.
   * The method becomes callable via HTTP POST /api/app/<id>/<method>
   * and IPC channel app:<id>:<method>.
   *
   * @param {string} appId
   * @param {string} methodName
   * @param {(params: Record<string, unknown>) => Promise<unknown>} handler
   */
  registerApi(appId, methodName, handler) {
    const key = `${appId}:${methodName}`;
    if (_methods.has(key)) {
      log.warn(`API method already registered, overwriting: ${key}`);
    }
    _methods.set(key, handler);

    let entry = _appIndex.get(appId);
    if (!entry) {
      entry = { methods: new Set(), streams: new Set() };
      _appIndex.set(appId, entry);
    }
    entry.methods.add(methodName);
    log.debug(`registered API: ${key}`);
  },

  /**
   * Register a stream handler for a app.
   * The stream becomes connectable via WS /api/app/<id>/<streamName>.
   *
   * @param {string} appId
   * @param {string} streamName
   * @param {() => StreamConnection} handler
   */
  registerStream(appId, streamName, handler) {
    const key = `${appId}:${streamName}`;
    if (_streams.has(key)) {
      log.warn(`Stream handler already registered, overwriting: ${key}`);
    }
    _streams.set(key, handler);

    let entry = _appIndex.get(appId);
    if (!entry) {
      entry = { methods: new Set(), streams: new Set() };
      _appIndex.set(appId, entry);
    }
    entry.streams.add(streamName);
    log.debug(`registered stream: ${key}`);
  },

  /**
   * Remove all registrations for a given app.
   * Called during app deactivation.
   *
   * @param {string} appId
   */
  unregisterApp(appId) {
    const entry = _appIndex.get(appId);
    if (!entry) return;

    for (const methodName of entry.methods) {
      _methods.delete(`${appId}:${methodName}`);
    }
    for (const streamName of entry.streams) {
      _streams.delete(`${appId}:${streamName}`);
    }
    _appIndex.delete(appId);
    log.info(`unregistered app: ${appId}`);
  },

  // ── HTTP route matching ───────────────────────────────────────────────────

  /**
   * Match an HTTP path against app API routes.
   *
   * @param {string} path - URL pathname (e.g. "/api/app/browser/greet")
   * @returns {{ appId: string, method: string, handler: Function } | false}
   */
  matchHttpRoute(path) {
    const m = path.match(/^\/api\/app\/([^/]+)\/([^/]+)$/);
    if (!m) return false;

    const appId = decodeURIComponent(m[1]);
    const method = decodeURIComponent(m[2]);
    const key = `${appId}:${method}`;
    const handler = _methods.get(key);
    if (!handler) return false;

    return { appId, method, handler };
  },

  // ── IPC channel matching ──────────────────────────────────────────────────

  /**
   * Match an IPC channel string against app API routes.
   *
   * @param {string} channel - IPC channel name (e.g. "app:browser:greet")
   * @returns {{ appId: string, method: string, handler: Function } | false}
   */
  matchIpcChannel(channel) {
    const m = channel.match(/^app:([^:]+):([^:]+)$/);
    if (!m) return false;

    const appId = m[1];
    const method = m[2];
    const key = `${appId}:${method}`;
    const handler = _methods.get(key);
    if (!handler) return false;

    return { appId, method, handler };
  },

  // ── WebSocket path matching ───────────────────────────────────────────────

  /**
   * Match a WebSocket upgrade path against app stream routes.
   *
   * @param {string} path - URL pathname (e.g. "/api/app/browser/logs")
   * @returns {{ appId: string, streamName: string, handler: Function } | false}
   */
  matchWsPath(path) {
    const m = path.match(/^\/api\/app\/([^/]+)\/([^/]+)$/);
    if (!m) return false;

    const appId = decodeURIComponent(m[1]);
    const streamName = decodeURIComponent(m[2]);
    const key = `${appId}:${streamName}`;
    const handler = _streams.get(key);
    if (!handler) return false;

    return { appId, streamName, handler };
  },

  // ── Introspection ─────────────────────────────────────────────────────────

  /**
   * Get all currently registered app ids.
   * @returns {string[]}
   */
  getRegisteredApps() {
    return Array.from(_appIndex.keys());
  },

  /**
   * Get the API method names registered for a app.
   * @param {string} appId
   * @returns {string[]}
   */
  getAppMethods(appId) {
    const entry = _appIndex.get(appId);
    return entry ? Array.from(entry.methods) : [];
  },

  /**
   * Get the stream names registered for a app.
   * @param {string} appId
   * @returns {string[]}
   */
  getAppStreams(appId) {
    const entry = _appIndex.get(appId);
    return entry ? Array.from(entry.streams) : [];
  },

  /**
   * Get an API method handler.
   * @param {string} appId
   * @param {string} methodName
   * @returns {Function | undefined}
   */
  getApiMethod(appId, methodName) {
    return _methods.get(`${appId}:${methodName}`);
  },

  /**
   * Get a stream handler factory.
   * @param {string} appId
   * @param {string} streamName
   * @returns {Function | undefined}
   */
  getStreamHandler(appId, streamName) {
    return _streams.get(`${appId}:${streamName}`);
  },

  /**
   * Clear all registrations (used in tests).
   */
  clear() {
    _methods.clear();
    _streams.clear();
    _appIndex.clear();
  },
};
