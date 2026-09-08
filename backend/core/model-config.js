/**
 * backend/core/model-config.js — Super built-in "model-config" app
 *
 * Registers model configuration CRUD API methods via defineApi().
 *
 * Methods:
 *   get          → modelConfigService.getMergedConfig()
 *   getBuiltIn   → modelConfigService.getBuiltInConfig()
 *   getCustom    → modelConfigService.getCustomConfig()
 *   saveCustom   → modelConfigService.saveCustomConfig(config)
 *   addCustom    → modelConfigService.addCustomProvider(entry)
 *   removeCustom → modelConfigService.removeCustomProvider(name)
 *   updateCustom → modelConfigService.updateCustomProvider(name, entry)
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import * as modelConfigService from '../services/model-config.js';

const APP_ID = 'model-config';

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router) {
  const host = createCoreAppHost(APP_ID, router);

  host.defineApi('get', async () => modelConfigService.getMergedConfig());

  host.defineApi('getBuiltIn', async () => modelConfigService.getBuiltInConfig());

  host.defineApi('getCustom', async () => modelConfigService.getCustomConfig());

  host.defineApi('saveCustom', async (params) => {
    modelConfigService.saveCustomConfig(params?.config);
    return { ok: true };
  });

  host.defineApi('addCustom', async (params) => {
    modelConfigService.addCustomProvider(params?.entry);
    return { ok: true };
  });

  host.defineApi('removeCustom', async (params) => {
    modelConfigService.removeCustomProvider(params?.name);
    return { ok: true };
  });

  host.defineApi('updateCustom', async (params) => {
    if (!params?.name) throw new Error('name is required');
    modelConfigService.updateCustomProvider(params.name, params.entry);
    return { ok: true };
  });
}
