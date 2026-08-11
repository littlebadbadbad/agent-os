/**
 * backend/services/proxy.js — Proxy configuration business logic
 *
 * ALL business logic lives here.
 * Transport layers (IPC, Network) delegate to these functions exclusively.
 */

import { getUpstreamConfig, setProxyConfig, testProxy, validateProxyUpdate, validateTestTarget } from '../lib/proxy.js';

/** @import { ProxyConfig } from '../../agent-type/app.ts' */

/**
 * Get the upstream proxy configuration (with masked password).
 * Used by the UI proxy manager — shows the actual upstream settings.
 * @returns {ProxyConfig}
 */
export function getConfig() {
  return getUpstreamConfig();
}

/**
 * Validate and update the proxy configuration.
 * @param {ProxyConfig} partial - Partial proxy config fields
 * @returns {{ config: ProxyConfig }}
 */
export function updateConfig(partial) {
  const valid = validateProxyUpdate(partial);
  const config = setProxyConfig(valid);
  return { config };
}

/**
 * Test connectivity through the proxy (or a set of overrides).
 * @param {string} target  - URL to test against
 * @param {object} [overrides] - Optional proxy config overrides
 * @returns {Promise<{ ok: boolean; ms: number; error?: string }>}
 */
export async function testProxyTarget(target, overrides) {
  validateTestTarget(target);
  return testProxy(target, overrides);
}
