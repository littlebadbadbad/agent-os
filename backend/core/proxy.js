/**
 * backend/core/proxy.js — Super built-in "proxy" app
 *
 * Registers proxy configuration API methods via defineApi().
 *
 * Methods:
 *   getConfig   → proxyService.getConfig()
 *   updateConfig → proxyService.updateConfig(partial)
 *   test         → proxyService.testProxyTarget(target, overrides)
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import * as proxyService from '../services/proxy.js';

const APP_ID = 'proxy';

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router) {
  const host = createCoreAppHost(APP_ID, router);

  host.defineApi('getConfig', async () => ({ config: proxyService.getConfig() }));

  host.defineApi('updateConfig', async (params) => proxyService.updateConfig(params));

  host.defineApi('test', async (params) => {
    const { target = 'https://www.google.com', ...rest } = params ?? {};
    const overrides = Object.keys(rest).length > 0 ? rest : undefined;
    const result = await proxyService.testProxyTarget(target, overrides);
    return { ok: result.ok, ms: result.ms, error: result.error };
  });
}
