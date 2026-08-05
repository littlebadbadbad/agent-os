/**
 * internal-plugins/dynamic-tool/backend/lib/proxyRequest.js
 *
 * Creates a proxy-aware fetch function for dynamic tool execution context.
 *
 * Tools receive `context.proxyRequest(url, init?)` which behaves like the
 * standard fetch API but routes through the configured proxy.  Each call
 * reads the latest proxy configuration so changes take effect immediately.
 */

export function createProxyRequest(getProxyConfig) {
  let _undici = null;

  async function _ensureUndici() {
    if (!_undici) {
      _undici = await import('undici');
    }
    return _undici;
  }

  return async function proxyRequest(url, init) {
    const cfg = getProxyConfig();
    if (!cfg || !cfg.port) {
      return globalThis.fetch(url, init);
    }
    const undici = await _ensureUndici();
    const proxyUri = `http://${cfg.host}:${cfg.port}`;
    const agent = new undici.ProxyAgent({
      uri: proxyUri,
      connectTimeout: cfg.connectTimeout ?? 10_000,
    });
    return undici.fetch(url, { ...init, dispatcher: agent });
  };
}
