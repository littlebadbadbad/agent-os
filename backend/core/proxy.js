/**
 * backend/core/proxy.js — Super built-in "proxy" plugin
 *
 * Registers proxy configuration API methods via defineApi().
 *
 * Methods:
 *   getConfig   → proxyService.getConfig()
 *   updateConfig → proxyService.updateConfig(partial)
 *   test         → proxyService.testProxyTarget(target, overrides)
 */

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import * as proxyService from '../services/proxy.js';

const PLUGIN_ID = 'proxy';

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  host.defineApi('getConfig', async () => ({ config: proxyService.getConfig() }));

  host.defineApi('updateConfig', async (params) => proxyService.updateConfig(params));

  host.defineApi('test', async (params) => {
    const { target = 'https://www.google.com', ...rest } = params ?? {};
    const overrides = Object.keys(rest).length > 0 ? rest : undefined;
    const result = await proxyService.testProxyTarget(target, overrides);
    return { ok: result.ok, ms: result.ms, error: result.error };
  });
}
