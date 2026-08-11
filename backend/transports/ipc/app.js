/**
 * backend/transports/ipc/app.js — Electron IPC handler for app API methods.
 *
 * Registers ipcMain.handle() channels for all currently registered app API
 * methods.  The app router's matchIpcChannel is used to route incoming calls.
 *
 * Because ipcMain.handle requires exact channel names (no wildcards), this
 * module registers a handler for each method at the time it's called.
 * Call `registerAppIpcHandlers` after app bootstrap to register
 * all active app methods.  Call `refreshAppIpcHandlers` when apps
 * are activated/deactivated at runtime.
 *
 * Channel format: app:<appId>:<methodName>
 *
 * Usage (in registerIpcHandlers):
 *   import { registerAppIpcHandlers } from './app.js';
 *   registerAppIpcHandlers(ipcMain, appRouter);
 */

import { createLogger } from '../../lib/logger.js';
import { createAppConfigStore } from '../../lib/app-config-store.js';
import { streamRegistry } from '../../lib/stream-registry.js';
import { DATA_ROOT } from '../../lib/paths.js';

/** @import { StreamConnection } from '../../../../agent-type/app.ts' */
/** @import { IpcMain } from 'electron' */
/** @import { appRouter } from '../../lib/app-router.js' */

const log = createLogger('ipc-app');
const appConfigStore = createAppConfigStore(DATA_ROOT);

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
 * Register IPC handlers for all currently active app API methods.
 * Also registers built-in app config handlers.
 * Call this AFTER app bootstrap.
 *
 * @param {IpcMain} ipcMain
 * @param {appRouter} router
 */
export function registerAppIpcHandlers(ipcMain, router) {
  // ── Built-in: app config handlers ────────────────────────────────────
  const configChannels = [
    {
      channel: 'app:config:get',
      handler: async (_event, params) => {
        const { appId, manifest } = params || {};
        if (!appId) throw new Error('appId is required');
        return appConfigStore.load(appId, manifest || undefined);
      },
    },
    {
      channel: 'app:config:set',
      handler: async (_event, params) => {
        const { appId, config } = params || {};
        if (!appId) throw new Error('appId is required');
        if (typeof config !== 'object' || config === null) throw new Error('config must be a JSON object');
        appConfigStore.save(appId, config);
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

  // ── Per-app method handlers ─────────────────────────────────────────
  const appIds = router.getRegisteredApps();

  for (const appId of appIds) {
    const methods = router.getAppMethods(appId);
    for (const method of methods) {
      const channel = `app:${appId}:${method}`;
      if (_registeredChannels.has(channel)) continue;

      ipcMain.handle(channel, async (_event, params) => {
        const match = router.matchIpcChannel(channel);
        if (!match) {
          throw new Error(`App method not found: ${channel}`);
        }
        return match.handler(params ?? {});
      });

      _registeredChannels.add(channel);
      log.debug(`Registered IPC channel: ${channel}`);
    }

    // ── Per-app stream handlers ─────────────────────────────────────────
    const streams = router.getAppStreams(appId);
    for (const streamName of streams) {
      const prefix = `app:${appId}:${streamName}`;

      // ── Connect: client → ipcMain.handle → StreamConnection ─────────
      const connectChannel = `${prefix}:connect`;
      if (!_registeredChannels.has(connectChannel)) {
        ipcMain.handle(connectChannel, async (event, params) => {
          const handler = router.getStreamHandler(appId, streamName);
          if (!handler) throw new Error(`Stream "${streamName}" not found for app "${appId}"`);

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
            tag: appId,
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

      // ── Message: client → app (via onClientMessage) ───────────────
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
 * Unregister and re-register all app IPC handlers.
 * Call this when apps are activated or deactivated at runtime.
 *
 * @param {IpcMain} ipcMain
 * @param {appRouter} router
 */
export function refreshAppIpcHandlers(ipcMain, router) {
  // Clear all previously registered channels.
  for (const channel of _registeredChannels) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore if handler doesn't exist
    }
  }
  _registeredChannels.clear();

  // Re-register all current app methods.
  registerAppIpcHandlers(ipcMain, router);
}
