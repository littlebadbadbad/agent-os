/**
 * backend/core/system.js — Super built-in "system" plugin
 *
 * Registers system-level API methods via defineApi().
 *
 * Methods:
 *   publicKey  → systemService.getPublicKeyInfo()
 *   health     → systemService.checkHealth()
 */

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import * as systemService from '../services/system.js';

const PLUGIN_ID = 'system';

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  host.defineApi('publicKey', async () => systemService.getPublicKeyInfo());

  host.defineApi('health', async () => systemService.checkHealth());
}
