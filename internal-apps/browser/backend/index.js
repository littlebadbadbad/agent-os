/**
 * internal-apps/browser/backend/index.js — Browser app backend activation entry
 *
 * Registers all browser API methods via BackendAppHost.
 * Delegates to the existing browser service functions.
 *
 * When compiled by compile-apps.mjs, esbuild bundles all dependencies
 * into a single self-contained apps/browser/backend/index.js file.
 */

import * as svc from './services/browser.js';
import { setProxyGetter } from './proxy-host.js';

/** @import { BackendAppHost, ProxyConfig, StreamConnection } from '../../../../agent-type/app.ts' */
/** @import { BrowserService } from '@agent-type/services' */

/** @type {(() => void) | undefined} */
let _unregisterService;

/**
 * Activate the browser app backend.
 * Registers all API methods.  Each receives params as Record<string, unknown>.
 *
 * @param {BackendAppHost} host
 */
export function activate(host) {
  // Inject proxy getter — the ONLY bridge to backend proxy config.
  setProxyGetter(() => /** @type {ProxyConfig} */ (host.getBackendConfig('proxy')));

  // ── Inter-app service registration ───────────────────────────────────
  // Expose the full browser management surface so other backend apps
  // (e.g., Skill for web scraping) can launch and control browser sessions
  // without going through the agent layer.

  /** @type {BrowserService} */
  const browserService = {
    listSessions: () => ({ sessions: svc.getBrowserList() }),
    createSession: (params) => svc.launchBrowser(params),
    closeSession: (params) => { svc.closeBrowser(params); },
    navigate: (params) => svc.navigateBrowser(params),
    evaluate: (params) => svc.evaluateBrowser(params),
    readOutput: (params) => svc.readBrowserOutput({ id: params.id, fromOffset: params.fromOffset ?? 0 }),
    snapshot: (params) => svc.snapshotBrowser(params),
    wait: (params) => svc.waitBrowser(params),
    screenshotData: (params) => svc.screenshotBrowser(params),
    setLaunchConfig: (params) => svc.configureBrowser(params),
    setProxy: (params) => svc.setBrowserProxy(params),
    switchTab: (params) => svc.switchBrowserTab(params),
    setViewportSize: (params) => svc.setViewportSize(params),
    getNetworkRequests: (params) => svc.getBrowserNetworkRequests(params),
    clearNetworkRequests: (params) => { svc.clearBrowserNetworkRequests(params); },
  };

  _unregisterService = host.services.register('browser', browserService);

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
  host.defineStream('browserStream', (params, io) => {
    const { id, config } = params || {};
    if (!id) throw new Error('browserStream: id is required');

    /** @type {StreamConnection} */
    const conn = {
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
        // io captured from handler param — no temporal coupling.
        const cleanup = svc.startBrowserStream({ id, io, config });
        return { unsubscribe: cleanup };
      },
    };

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

/**
 * Deactivate hook — called by the app lifecycle when the app is
 * disabled or uninstalled.  Unregisters inter-app services and closes
 * all browser sessions (Playwright processes, network connections).
 * Symmetric to activate(host).
 */
export async function deactivate() {
  if (_unregisterService) {
    _unregisterService();
    _unregisterService = undefined;
  }
  await svc.closeAllBrowsers();
}
