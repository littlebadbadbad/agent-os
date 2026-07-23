/**
 * backend/core/model-config.js — Super built-in "model-config" plugin
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

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import * as modelConfigService from '../services/model-config.js';

const PLUGIN_ID = 'model-config';

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  host.defineApi('get', async () => modelConfigService.getMergedConfig());

  host.defineApi('getBuiltIn', async () => modelConfigService.getBuiltInConfig());

  host.defineApi('getCustom', async () => modelConfigService.getCustomConfig());

  host.defineApi('saveCustom', async (params) => {
    modelConfigService.saveCustomConfig(params);
    return { ok: true };
  });

  host.defineApi('addCustom', async (params) => {
    modelConfigService.addCustomProvider(params);
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
