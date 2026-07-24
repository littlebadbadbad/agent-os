/**
 * backend/lib/services/browser.js — Browser-session business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here.
 */

/** @import { WebContents } from 'electron' */
/** @import { WebSocket } from 'ws' */
/** @import { StreamIO } from '../lib/browser-manager/browser-instance.js' */

import {
  createBrowser,
  getBrowser,
  listBrowserEntries,
  removeBrowser,
} from '../lib/browser-manager/index.js';

export { closeAllBrowsers } from '../lib/browser-manager/index.js';

export function getBrowserList() {
  return listBrowserEntries();
}

export async function launchBrowser({ label, headless, startUrl, useProxy, launchConfig } = {}) {
  const browser = await createBrowser({ label, headless, startUrl, useProxy, launchConfig });
  return browser.info();
}

export function closeBrowser({ id }) {
  if (!id) throw new Error('id is required');
  return removeBrowser(id);
}

export async function navigateBrowser({ id, url, waitUntil, timeout }) {
  if (!id) throw new Error('id is required');
  if (!url) throw new Error('url is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  return browser.navigate(url, { waitUntil, timeout });
}

export async function evaluateBrowser({ id, script }) {
  if (!id) throw new Error('id is required');
  if (!script) throw new Error('script is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  const result = await browser.evaluate(script);
  return { result: result ?? null };
}

export async function readBrowserOutput({ id, fromOffset }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  return browser.read(fromOffset ?? 0);
}

export async function snapshotBrowser({ id }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  return browser.snapshot();
}

export async function screenshotBrowser({ id, selector }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  const buf = selector
    ? await browser.elementScreenshot(selector, { quality: 60 })
    : await browser.screenshot({ quality: 60 });
  return { data: buf.toString('base64'), mimeType: 'image/jpeg' };
}

export async function waitBrowser({ id, selector, waitUntil, timeout }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  return browser.wait({ selector, waitUntil, timeout });
}

export async function configureBrowser({ id, config }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  await browser.setLaunchConfig(config);
  return browser.info();
}

/**
 * Toggle proxy on an existing browser session.
 * Since proxy is a launch-time configuration, this tears down and recreates
 * the browser instance with the updated proxy setting behind the scenes.
 * Returns the updated session info.
 */
export async function setBrowserProxy({ id, useProxy }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  await browser.setLaunchConfig({ useProxy });
  return browser.info();
}

export async function switchBrowserTab({ id, index }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  await browser.switchTab(index);
  return browser.info();
}

export async function getBrowserNetworkRequests({ id, opts }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  return browser.getNetworkRequests(opts ?? {});
}

export async function clearBrowserNetworkRequests({ id, opts }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  await browser.clearNetworkRequests(opts ?? {});
}

export async function updateBrowserStreamConfig({ id, config }) {
  if (!id) throw new Error('id is required');
  if (!config) throw new Error('config is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  browser.updateStreamConfig(config);
  return { ok: true };
}

export async function setViewportSize({ id, width, height }) {
  if (!id) throw new Error('id is required');
  if (width === undefined || height === undefined) throw new Error('width and height are required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  await browser.setViewportSize(width, height);
  return browser.info();
}

// ── Streaming helpers (no Electron dependency — transport provides webContents) ──

/**
 * Get a browser session instance — throws if not found.
 * Use this instead of calling getBrowser() + null check in transport layers.
 * @returns {object} BrowserInstance
 */
export function getBrowserSession({ id }) {
  if (!id) throw new Error('id is required');
  const browser = getBrowser(id);
  if (!browser) throw new Error(`Browser session "${id}" not found`);
  return browser;
}

/**
 * Dispatch a user input event (mouse, keyboard, wheel, type) to a browser session.
 */
export async function dispatchBrowserInput({ id, event }) {
  const browser = getBrowserSession({ id });
  await browser.dispatchInput(event);
  return { ok: true };
}

/**
 * Start streaming browser frames to an Electron WebContents.
 * Transport layer provides the webContents — this function just wires them up.
 *
 * @param {{ id: string, config?: object, webContents: WebContents }} opts
 * @returns {() => void} Cleanup function
 */
export function startBrowserStreamToWebContents({ id, config, webContents }) {
  const browser = getBrowserSession({ id });
  if (config?.fps !== undefined || config?.quality !== undefined) {
    browser.updateStreamConfig({
      fps: config.fps,
      quality: config.quality,
    });
  }
  return browser.startStreamingToWebContents(webContents);
}

/**
 * Take a raw JPEG screenshot and return the Buffer (not base64).
 * Used by the transport-specific raw-image endpoint.
 *
 * @param {{ id: string, quality?: number }} opts
 * @returns {Promise<Buffer>}
 */
export async function takeRawScreenshot({ id, quality = 70 }) {
  const browser = getBrowserSession({ id });
  return browser.screenshot({ quality: Math.min(Math.max(quality, 10), 100) });
}

/**
 * Start streaming to a WebSocket — returns stop function.
 * Used by the HTTP transport's WebSocket upgrade handler.
 *
 * @param {{ id: string, ws: WebSocket, config?: object }} opts
 * @returns {() => void} Stop function
 */
export function startBrowserStreamToWebSocket({ id, ws, config }) {
  const browser = getBrowserSession({ id });
  if (config?.fps !== undefined || config?.quality !== undefined) {
    browser.updateStreamConfig(config);
  }
  return browser.startStreaming(ws);
}

/**
 * Start streaming to a generic StreamIO interface.
 * Used by the plugin streaming system — the transport layer creates a
 * StreamIO from the plugin's StreamCallbacks so the streaming loop is
 * transport-agnostic.
 *
 * @param {{ id: string, io: StreamIO, config?: object }} opts
 * @returns {() => void} Stop function
 */
export function startBrowserStream({ id, io, config }) {
  const browser = getBrowserSession({ id });
  if (config?.fps !== undefined || config?.quality !== undefined) {
    browser.updateStreamConfig(config);
  }
  return browser.startStreamingIO(io);
}
