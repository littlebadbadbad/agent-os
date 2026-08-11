/**
 * backend/core/sessions.js — Super built-in "sessions" app
 *
 * Registers session persistence API methods via defineApi().
 *
 * Methods:
 *   load → sessionService.loadAgentSessions({ agentId })
 *   save → sessionService.saveAgentSessions({ agentId, sessions })
 */

import { createCoreAppHost } from '../lib/core-app-host.js';
import * as sessionService from '../services/sessions.js';

const APP_ID = 'sessions';

/** @param {import('../lib/app-router.js').appRouter} router */
export function register(router) {
  const host = createCoreAppHost(APP_ID, router);

  host.defineApi('load', async (params) => {
    return sessionService.loadAgentSessions(params);
  });

  host.defineApi('save', async (params) => {
    return sessionService.saveAgentSessions(params);
  });
}
