/**
 * extensions/browser/backend/index.js — Browser plugin backend activation entry
 *
 * Registers all browser API methods via BackendPluginHost.
 * Delegates to the existing browser service functions.
 *
 * When compiled by compile-plugins.mjs, esbuild bundles all dependencies
 * into a single self-contained plugins/browser/backend/index.js file.
 */

import * as svc from './services/browser.js';
import { setProxyGetter } from './proxy-host.js';

/**
 * Activate the browser plugin backend.
 * Registers all API methods.  Each receives params as Record<string, unknown>.
 *
 * @param {import('../../../../agent-type/plugin.ts').BackendPluginHost} host
 */
export function activate(host) {
  // Inject proxy getter — the ONLY bridge to backend proxy config.
  setProxyGetter(() => /** @type {import('../../../../agent-type/plugin.ts').ProxyConfig} */ (host.getBackendConfig('proxy')));

  // ── CRUD sessions ──────────────────────────────────────────────────────
  host.defineApi('listSessions', async (_params) => ({ sessions: svc.getBrowserList() }));
  host.defineApi('createSession', async (params) => svc.launchBrowser(params || {}));
  host.defineApi('closeSession', async (params) => { await svc.closeBrowser({ id: params?.id }); return { ok: true }; });

  // ── Navigation & evaluation ─────────────────────────────────────────────
  host.defineApi('navigate', async (params) => {
    const { id, url, waitUntil, timeout } = params || {};
    return svc.navigateBrowser({ id, url, waitUntil, timeout });
  });
  host.defineApi('evaluate', async (params) => {
    const { id, script } = params || {};
    return svc.evaluateBrowser({ id, script });
  });

  // ── Output & state ──────────────────────────────────────────────────────
  host.defineApi('readOutput', async (params) => {
    const { id, fromOffset } = params || {};
    return svc.readBrowserOutput({ id, fromOffset: fromOffset ?? 0 });
  });
  host.defineApi('snapshot', async (params) => svc.snapshotBrowser({ id: params?.id }));
  host.defineApi('wait', async (params) => {
    const { id, selector, waitUntil, timeout } = params || {};
    return svc.waitBrowser({ id, selector, waitUntil, timeout });
  });
  host.defineApi('screenshotData', async (params) => {
    const { id, selector } = params || {};
    return svc.screenshotBrowser({ id, selector });
  });

  // ── Configuration ───────────────────────────────────────────────────────
  host.defineApi('setLaunchConfig', async (params) => {
    const { id, config } = params || {};
    return svc.configureBrowser({ id, config });
  });
  host.defineApi('setProxy', async (params) => {
    const { id, useProxy } = params || {};
    return svc.setBrowserProxy({ id, useProxy });
  });

  // ── Tab & viewport ──────────────────────────────────────────────────────
  host.defineApi('switchTab', async (params) => {
    const { id, index } = params || {};
    return svc.switchBrowserTab({ id, index });
  });
  host.defineApi('setViewportSize', async (params) => {
    const { id, width, height } = params || {};
    return svc.setViewportSize({ id, width, height });
  });

  // ── Network ─────────────────────────────────────────────────────────────
  host.defineApi('getNetworkRequests', async (params) => {
    const { id, ...opts } = params || {};
    return svc.getBrowserNetworkRequests({ id, opts });
  });
  host.defineApi('clearNetworkRequests', async (params) => {
    const { id, ...opts } = params || {};
    await svc.clearBrowserNetworkRequests({ id, opts });
    return { ok: true };
  });

  // ── Stream live browser frames ──────────────────────────────────────────
  host.defineStream('browserStream', (params) => {
    const { id, config } = params || {};
    if (!id) throw new Error('browserStream: id is required');

    let stopCleanup = null;
    /** @type {import('../../../../agent-type/plugin.ts').StreamConnection|null} */
    let self = null;

    const conn = {
      callbacks: {
        onData(_chunk) {
          // Overridden by transport layer — writes to IPC/WS
        },
        onEnd() { stopCleanup?.(); },
        onError(_err) { stopCleanup?.(); },
      },
      // Handle client messages sent via the stream channel.
      // The primary path for input/config is via separate defineApi calls,
      // but onClientMessage serves as a secondary channel.
      onClientMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        const input = /** @type {Record<string, unknown>} */ (msg);
        if (input.type === 'input') {
          svc.dispatchBrowserInput({ id, event: input.event }).catch(() => {});
        } else if (input.type === 'updateConfig') {
          svc.updateBrowserStreamConfig({ id, config: input.config }).catch(() => {});
        }
      },
      subscribe: () => {
        // The transport layer set conn.io before calling subscribe().
        const io = conn.io;
        if (io) {
          stopCleanup = svc.startBrowserStream({ id, io, config });
        }
        return {
          unsubscribe: () => {
            if (stopCleanup) { stopCleanup(); stopCleanup = null; }
          },
        };
      },
    };

    self = conn;
    return conn;
  });

  // ── Streaming input & config helpers ─────────────────────────────────────
  host.defineApi('dispatchInput', async (params) => {
    const { id, event } = params || {};
    if (!id || !event) throw new Error('dispatchInput: id and event are required');
    return svc.dispatchBrowserInput({ id, event });
  });

  host.defineApi('updateStreamConfig', async (params) => {
    const { id, config } = params || {};
    if (!id || !config) throw new Error('updateStreamConfig: id and config are required');
    return svc.updateBrowserStreamConfig({ id, config });
  });
}
