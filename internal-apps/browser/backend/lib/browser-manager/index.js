/**
 * browser-manager — public API for Playwright browser session management.
 *
 * Thin coordination layer on top of BrowserInstance, mirroring the
 * shell-manager pattern exactly.
 *
 * Exported surface (consumed by routes/browser.js):
 *   createBrowser(opts?)          → Promise<BrowserInstance>
 *   getBrowser(id)                → BrowserInstance | null
 *   listBrowserEntries()          → info[]
 *   removeBrowser(id)             → Promise<boolean>
 */

import { randomBytes } from 'crypto';
import { BrowserInstance } from './browser-instance.js';

/** @type {Map<string, BrowserInstance>} */
const _browsers = new Map();

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create, launch, and register a new browser session.
 *
 * @param {{ label?: string; headless?: boolean; startUrl?: string; useProxy?: boolean; launchConfig?: object }} [opts]
 * @returns {Promise<BrowserInstance>}
 */
export async function createBrowser({ label, headless, startUrl, useProxy = true, launchConfig } = {}) {
  const id      = `browser_${randomBytes(4).toString('hex')}`;
  // headless can be specified at top level (legacy) or inside launchConfig.
  const mergedConfig = headless !== undefined
    ? { ...launchConfig, headless }
    : launchConfig;
  const browser = new BrowserInstance(id, { label, useProxy, launchConfig: mergedConfig });
  await browser.launch(startUrl);
  _browsers.set(id, browser);
  return browser;
}

/**
 * Look up a session by id.
 * @param {string} id
 * @returns {BrowserInstance | null}
 */
export function getBrowser(id) {
  return _browsers.get(id) ?? null;
}

/**
 * Return serialisable info for all registered sessions.
 * @returns {ReturnType<BrowserInstance['info']>[]}
 */
export function listBrowserEntries() {
  return [..._browsers.values()].map(b => b.info());
}

/**
 * Close and deregister a browser session.
 * @param {string} id
 * @returns {Promise<boolean>} false if the id was not found
 */
export async function removeBrowser(id) {
  const browser = _browsers.get(id);
  if (!browser) return false;
  await browser.close();
  _browsers.delete(id);
  return true;
}

/**
 * Close and deregister ALL browser sessions.
 * Used by the app deactivation lifecycle — symmetric to activate().
 * Safe to call multiple times; browsers already closed are skipped.
 */
export async function closeAllBrowsers() {
  const ids = Array.from(_browsers.keys());
  const results = await Promise.allSettled(ids.map((id) => removeBrowser(id)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[browser-manager] ${failed}/${ids.length} browser(s) failed to close during cleanup`);
  }
}

// ── Cleanup on server exit ─────────────────────────────────────────────────────
process.on('exit', () => {
  for (const b of _browsers.values()) b.close().catch(() => {});
});
