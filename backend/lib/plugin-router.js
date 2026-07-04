/**
 * backend/lib/plugin-router.js — Central routing registry for backend plugins.
 *
 * Plugins register API methods and stream handlers via their BackendPluginHost.
 * The router aggregates all registrations and exposes match functions used by
 * the HTTP server, IPC layer, and WebSocket upgrade handler.
 *
 * Routing protocol (keep in sync with the type contract):
 *   HTTP  → POST /api/plugin/<pluginId>/<method>
 *   IPC   → plugin:<pluginId>:<method>
 *   WS    → /api/plugin/<pluginId>/<streamName>
 *
 * Usage:
 *   import { pluginRouter } from './plugin-router.js';
 *   pluginRouter.registerApi('browser', 'greet', async (params) => `hello ${params.name}`);
 */

import { createLogger } from './logger.js';

const log = createLogger('plugin-router');

// ── Internal state ───────────────────────────────────────────────────────────

/**
 * Map key → handler.
 * Key format: "<pluginId>:<methodName>" for API methods.
 * @type {Map<string, (params: Record<string, unknown>) => Promise<unknown>>}
 */
const _methods = new Map();

/**
 * Map key → stream handler factory.
 * Key format: "<pluginId>:<streamName>" for streams.
 * @type {Map<string, () => import('../../agent-type/plugin.ts').StreamConnection>}
 */
const _streams = new Map();

/**
 * Track which methods/streams belong to each plugin for bulk unregistration.
 * @type {Map<string, { methods: Set<string>, streams: Set<string> }>}
 */
const _pluginIndex = new Map();

// ── Public API ───────────────────────────────────────────────────────────────

export const pluginRouter = {
  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register an API method for a plugin.
   * The method becomes callable via HTTP POST /api/plugin/<id>/<method>
   * and IPC channel plugin:<id>:<method>.
   *
   * @param {string} pluginId
   * @param {string} methodName
   * @param {(params: Record<string, unknown>) => Promise<unknown>} handler
   */
  registerApi(pluginId, methodName, handler) {
    const key = `${pluginId}:${methodName}`;
    if (_methods.has(key)) {
      log.warn(`API method already registered, overwriting: ${key}`);
    }
    _methods.set(key, handler);

    let entry = _pluginIndex.get(pluginId);
    if (!entry) {
      entry = { methods: new Set(), streams: new Set() };
      _pluginIndex.set(pluginId, entry);
    }
    entry.methods.add(methodName);
    log.debug(`registered API: ${key}`);
  },

  /**
   * Register a stream handler for a plugin.
   * The stream becomes connectable via WS /api/plugin/<id>/<streamName>.
   *
   * @param {string} pluginId
   * @param {string} streamName
   * @param {() => import('../../agent-type/plugin.ts').StreamConnection} handler
   */
  registerStream(pluginId, streamName, handler) {
    const key = `${pluginId}:${streamName}`;
    if (_streams.has(key)) {
      log.warn(`Stream handler already registered, overwriting: ${key}`);
    }
    _streams.set(key, handler);

    let entry = _pluginIndex.get(pluginId);
    if (!entry) {
      entry = { methods: new Set(), streams: new Set() };
      _pluginIndex.set(pluginId, entry);
    }
    entry.streams.add(streamName);
    log.debug(`registered stream: ${key}`);
  },

  /**
   * Remove all registrations for a given plugin.
   * Called during plugin deactivation.
   *
   * @param {string} pluginId
   */
  unregisterPlugin(pluginId) {
    const entry = _pluginIndex.get(pluginId);
    if (!entry) return;

    for (const methodName of entry.methods) {
      _methods.delete(`${pluginId}:${methodName}`);
    }
    for (const streamName of entry.streams) {
      _streams.delete(`${pluginId}:${streamName}`);
    }
    _pluginIndex.delete(pluginId);
    log.info(`unregistered plugin: ${pluginId}`);
  },

  // ── HTTP route matching ───────────────────────────────────────────────────

  /**
   * Match an HTTP path against plugin API routes.
   *
   * @param {string} path - URL pathname (e.g. "/api/plugin/browser/greet")
   * @returns {{ pluginId: string, method: string, handler: Function } | false}
   */
  matchHttpRoute(path) {
    const m = path.match(/^\/api\/plugin\/([^/]+)\/([^/]+)$/);
    if (!m) return false;

    const pluginId = decodeURIComponent(m[1]);
    const method = decodeURIComponent(m[2]);
    const key = `${pluginId}:${method}`;
    const handler = _methods.get(key);
    if (!handler) return false;

    return { pluginId, method, handler };
  },

  // ── IPC channel matching ──────────────────────────────────────────────────

  /**
   * Match an IPC channel string against plugin API routes.
   *
   * @param {string} channel - IPC channel name (e.g. "plugin:browser:greet")
   * @returns {{ pluginId: string, method: string, handler: Function } | false}
   */
  matchIpcChannel(channel) {
    const m = channel.match(/^plugin:([^:]+):([^:]+)$/);
    if (!m) return false;

    const pluginId = m[1];
    const method = m[2];
    const key = `${pluginId}:${method}`;
    const handler = _methods.get(key);
    if (!handler) return false;

    return { pluginId, method, handler };
  },

  // ── WebSocket path matching ───────────────────────────────────────────────

  /**
   * Match a WebSocket upgrade path against plugin stream routes.
   *
   * @param {string} path - URL pathname (e.g. "/api/plugin/browser/logs")
   * @returns {{ pluginId: string, streamName: string, handler: Function } | false}
   */
  matchWsPath(path) {
    const m = path.match(/^\/api\/plugin\/([^/]+)\/([^/]+)$/);
    if (!m) return false;

    const pluginId = decodeURIComponent(m[1]);
    const streamName = decodeURIComponent(m[2]);
    const key = `${pluginId}:${streamName}`;
    const handler = _streams.get(key);
    if (!handler) return false;

    return { pluginId, streamName, handler };
  },

  // ── Introspection ─────────────────────────────────────────────────────────

  /**
   * Get all currently registered plugin ids.
   * @returns {string[]}
   */
  getRegisteredPlugins() {
    return Array.from(_pluginIndex.keys());
  },

  /**
   * Get the API method names registered for a plugin.
   * @param {string} pluginId
   * @returns {string[]}
   */
  getPluginMethods(pluginId) {
    const entry = _pluginIndex.get(pluginId);
    return entry ? Array.from(entry.methods) : [];
  },

  /**
   * Get the stream names registered for a plugin.
   * @param {string} pluginId
   * @returns {string[]}
   */
  getPluginStreams(pluginId) {
    const entry = _pluginIndex.get(pluginId);
    return entry ? Array.from(entry.streams) : [];
  },

  /**
   * Get an API method handler.
   * @param {string} pluginId
   * @param {string} methodName
   * @returns {Function | undefined}
   */
  getApiMethod(pluginId, methodName) {
    return _methods.get(`${pluginId}:${methodName}`);
  },

  /**
   * Get a stream handler factory.
   * @param {string} pluginId
   * @param {string} streamName
   * @returns {Function | undefined}
   */
  getStreamHandler(pluginId, streamName) {
    return _streams.get(`${pluginId}:${streamName}`);
  },

  /**
   * Clear all registrations (used in tests).
   */
  clear() {
    _methods.clear();
    _streams.clear();
    _pluginIndex.clear();
  },
};
