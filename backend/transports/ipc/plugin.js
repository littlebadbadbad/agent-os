/**
 * backend/transports/ipc/plugin.js — Electron IPC handler for plugin API methods.
 *
 * Registers ipcMain.handle() channels for all currently registered plugin API
 * methods.  The plugin router's matchIpcChannel is used to route incoming calls.
 *
 * Because ipcMain.handle requires exact channel names (no wildcards), this
 * module registers a handler for each method at the time it's called.
 * Call `registerPluginIpcHandlers` after plugin bootstrap to register
 * all active plugin methods.  Call `refreshPluginIpcHandlers` when plugins
 * are activated/deactivated at runtime.
 *
 * Channel format: plugin:<pluginId>:<methodName>
 *
 * Usage (in registerIpcHandlers):
 *   import { registerPluginIpcHandlers } from './plugin.js';
 *   registerPluginIpcHandlers(ipcMain, pluginRouter);
 */

import { createLogger } from '../../lib/logger.js';
import { createPluginConfigStore } from '../../lib/plugin-config-store.js';
import { streamRegistry } from '../../lib/stream-registry.js';
import { DATA_ROOT } from '../../lib/paths.js';

/** @import { StreamConnection } from '../../../../agent-type/plugin.ts' */
/** @import { IpcMain } from 'electron' */
/** @import { pluginRouter } from '../../lib/plugin-router.js' */

const log = createLogger('ipc-plugin');
const pluginConfigStore = createPluginConfigStore(DATA_ROOT);

/**
 * Registry of registered IPC channels so we can unregister them on refresh.
 * @type {Set<string>}
 */
const _registeredChannels = new Set();

/**
 * Active stream connections keyed by connection id.
 * Used by stream message/disconnect handlers to find the connection object.
 * @type {Map<string, StreamConnection>}
 */
const _activeStreamConnections = new Map();

/**
 * Register IPC handlers for all currently active plugin API methods.
 * Also registers built-in plugin config handlers.
 * Call this AFTER plugin bootstrap.
 *
 * @param {IpcMain} ipcMain
 * @param {pluginRouter} router
 */
export function registerPluginIpcHandlers(ipcMain, router) {
  // ── Built-in: plugin config handlers ────────────────────────────────────
  const configChannels = [
    {
      channel: 'plugin:config:get',
      handler: async (_event, params) => {
        const { pluginId, manifest } = params || {};
        if (!pluginId) throw new Error('pluginId is required');
        return pluginConfigStore.load(pluginId, manifest || undefined);
      },
    },
    {
      channel: 'plugin:config:set',
      handler: async (_event, params) => {
        const { pluginId, config } = params || {};
        if (!pluginId) throw new Error('pluginId is required');
        if (typeof config !== 'object' || config === null) throw new Error('config must be a JSON object');
        pluginConfigStore.save(pluginId, config);
        return { ok: true };
      },
    },
  ];

  for (const { channel, handler } of configChannels) {
    if (_registeredChannels.has(channel)) continue;
    ipcMain.handle(channel, handler);
    _registeredChannels.add(channel);
    log.debug(`Registered IPC channel: ${channel}`);
  }

  // ── Per-plugin method handlers ─────────────────────────────────────────
  const pluginIds = router.getRegisteredPlugins();

  for (const pluginId of pluginIds) {
    const methods = router.getPluginMethods(pluginId);
    for (const method of methods) {
      const channel = `plugin:${pluginId}:${method}`;
      if (_registeredChannels.has(channel)) continue;

      ipcMain.handle(channel, async (_event, params) => {
        const match = router.matchIpcChannel(channel);
        if (!match) {
          throw new Error(`Plugin method not found: ${channel}`);
        }
        return match.handler(params ?? {});
      });

      _registeredChannels.add(channel);
      log.debug(`Registered IPC channel: ${channel}`);
    }

    // ── Per-plugin stream handlers ─────────────────────────────────────────
    const streams = router.getPluginStreams(pluginId);
    for (const streamName of streams) {
      const prefix = `plugin:${pluginId}:${streamName}`;

      // ── Connect: client → ipcMain.handle → StreamConnection ─────────
      const connectChannel = `${prefix}:connect`;
      if (!_registeredChannels.has(connectChannel)) {
        ipcMain.handle(connectChannel, async (event, params) => {
          const handler = router.getStreamHandler(pluginId, streamName);
          if (!handler) throw new Error(`Stream "${streamName}" not found for plugin "${pluginId}"`);

          // Build StreamIO first, then pass to handler — no temporal coupling.
          const io = {
            sendBinary: (buf) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(`${prefix}:frame`, buf);
              }
            },
            sendJSON: (obj) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(`${prefix}:data`, obj);
              }
            },
            isConnected: () => !event.sender.isDestroyed(),
            onClose: (cb) => {
              event.sender.on('destroyed', () => cb());
            },
            close: () => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(`${prefix}:end`);
              }
            },
          };

          const connection = handler(params ?? {}, io);
          const connId = `${connectChannel}:${event.sender.id ?? Date.now()}`;

          // Subscribe to start the streaming loop.
          const sub = connection.subscribe();

          // Store for disconnect/message routing.
          _activeStreamConnections.set(connId, connection);
          streamRegistry.set(connId, {
            tag: pluginId,
            cleanup: () => sub.unsubscribe(),
            meta: { streamName, senderId: event.sender.id },
          });

          // Cleanup when the renderer window closes.
          event.sender.on('destroyed', () => {
            sub.unsubscribe();
            _activeStreamConnections.delete(connId);
          });

          return { ok: true, connectionId: connId };
        });
        _registeredChannels.add(connectChannel);
        log.debug(`Registered IPC channel: ${connectChannel}`);
      }

      // ── Message: client → plugin (via onClientMessage) ───────────────
      const messageChannel = `${prefix}:message`;
      if (!_registeredChannels.has(messageChannel)) {
        ipcMain.handle(messageChannel, async (_event, params) => {
          const { connectionId, data } = params ?? {};
          if (!connectionId) throw new Error('connectionId is required');

          const connection = _activeStreamConnections.get(connectionId);
          if (!connection) throw new Error(`Stream connection not found: ${connectionId}`);

          if (connection.onClientMessage) {
            connection.onClientMessage(data);
          }
          return { ok: true };
        });
        _registeredChannels.add(messageChannel);
        log.debug(`Registered IPC channel: ${messageChannel}`);
      }

      // ── Disconnect: client requests stream teardown ──────────────────
      const disconnectChannel = `${prefix}:disconnect`;
      if (!_registeredChannels.has(disconnectChannel)) {
        ipcMain.handle(disconnectChannel, async (_event, params) => {
          const { connectionId } = params ?? {};
          if (!connectionId) return { ok: false };

          const entry = streamRegistry.get(connectionId);
          if (entry?.cleanup) entry.cleanup();
          streamRegistry.delete(connectionId);
          _activeStreamConnections.delete(connectionId);

          return { ok: true };
        });
        _registeredChannels.add(disconnectChannel);
        log.debug(`Registered IPC channel: ${disconnectChannel}`);
      }
    }
  }
}

/**
 * Unregister and re-register all plugin IPC handlers.
 * Call this when plugins are activated or deactivated at runtime.
 *
 * @param {IpcMain} ipcMain
 * @param {pluginRouter} router
 */
export function refreshPluginIpcHandlers(ipcMain, router) {
  // Clear all previously registered channels.
  for (const channel of _registeredChannels) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore if handler doesn't exist
    }
  }
  _registeredChannels.clear();

  // Re-register all current plugin methods.
  registerPluginIpcHandlers(ipcMain, router);
}
