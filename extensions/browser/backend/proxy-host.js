/**
 * extensions/browser/backend/proxy-host.js — Proxy config bridge for browser plugin.
 *
 * This is the ONLY file in the browser plugin that touches proxy config.
 * The getter is injected at activation time via {@link setProxyGetter},
 * which captures a reference to the backend's runtime proxy config through
 * `host.getBackendConfig('proxy')` — no direct imports of backend modules.
 *
 * Usage in activate():
 *   import { setProxyGetter } from './proxy-host.js';
 *   setProxyGetter(() => host.getBackendConfig('proxy'));
 *
 * Usage in browser-instance.js:
 *   import { getProxy } from '../../proxy-host.js';
 *   const proxyCfg = getProxy();
 */

/** @import { ProxyConfig } from '../../../../agent-type/plugin.ts' */

/** @type {() => ProxyConfig} */
let _getProxy = () => ({
  protocol:       'http',
  host:           'localhost',
  port:           7890,
  username:       '',
  password:       '',
  noProxy:        '',
  connectTimeout: 10_000,
});

/**
 * Set the proxy-getter function.
 * Called once during plugin activation.
 *
 * @param {() => ProxyConfig} getter
 */
export function setProxyGetter(getter) {
  _getProxy = getter;
}

/**
 * Get the current proxy configuration from the backend.
 * Lazy — always returns the latest value on each call.
 *
 * @returns {ProxyConfig}
 */
export function getProxy() {
  return _getProxy();
}
