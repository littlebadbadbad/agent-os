/**
 * backend/core/system.js — Super built-in "system" app
 *
 * Registers system-level API methods via defineApi().
 *
 * Methods:
 *   publicKey  → systemService.getPublicKeyInfo()
 *   health     → systemService.checkHealth()
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import * as systemService from '../services/system.js';

const APP_ID = 'system';

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router) {
  const host = createCoreAppHost(APP_ID, router);

  host.defineApi('publicKey', async () => systemService.getPublicKeyInfo());

  host.defineApi('health', async () => systemService.checkHealth());
}
