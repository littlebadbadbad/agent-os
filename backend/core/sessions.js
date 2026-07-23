/**
 * backend/core/sessions.js — Super built-in "sessions" plugin
 *
 * Registers session persistence API methods via defineApi().
 *
 * Methods:
 *   load → sessionService.loadAgentSessions({ agentId })
 *   save → sessionService.saveAgentSessions({ agentId, sessions })
 */

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import * as sessionService from '../services/sessions.js';

const PLUGIN_ID = 'sessions';

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  host.defineApi('load', async (params) => {
    return sessionService.loadAgentSessions(params);
  });

  host.defineApi('save', async (params) => {
    return sessionService.saveAgentSessions(params);
  });
}
