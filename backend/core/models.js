/**
 * backend/core/models.js — Super built-in "models" app
 *
 * Registers model listing API method via defineApi().
 *
 * Methods:
 *   list → listModels(provider)
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import { listModels } from '../services/models.js';

const APP_ID = 'models';

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router) {
  const host = createCoreAppHost(APP_ID, router);

  host.defineApi('list', async (params) => {
    const provider = params?.provider;
    return listModels(provider);
  });
}
