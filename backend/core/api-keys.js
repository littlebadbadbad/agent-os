/**
 * backend/core/api-keys.js — Super built-in "api-keys" app
 *
 * Registers API key management methods via defineApi().
 *
 * Methods:
 *   list   → getKeyList()
 *   save   → saveKey(providerId, encryptedKey)
 *   delete → removeKey(providerId)
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import { getKeyList, saveKey, removeKey } from '../services/api-keys.js';

const APP_ID = 'api-keys';

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router) {
  const host = createCoreAppHost(APP_ID, router);

  host.defineApi('list', async () => getKeyList());

  host.defineApi('save', async (params) => {
    const { providerId, encryptedKey } = params ?? {};
    if (!providerId) throw new Error('providerId is required');
    return saveKey(providerId, encryptedKey);
  });

  host.defineApi('delete', async (params) => {
    const { providerId } = params ?? {};
    if (!providerId) throw new Error('providerId is required');
    return removeKey(providerId);
  });
}
