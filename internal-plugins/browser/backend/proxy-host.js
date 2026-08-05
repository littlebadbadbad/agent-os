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
