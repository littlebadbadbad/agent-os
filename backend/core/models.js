/**
 * backend/core/models.js — Super built-in "models" plugin
 *
 * Registers model listing API method via defineApi().
 *
 * Methods:
 *   list → listModels(provider)
 */

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import { listModels } from '../services/models.js';

const PLUGIN_ID = 'models';

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  host.defineApi('list', async (params) => {
    const provider = params?.provider;
    return listModels(provider);
  });
}
