/**
 * extensions/git/backend/index.js — Git backend plugin
 *
 * Registers all Git API methods via host.defineApi().
 */

import * as svc from './services/git.js';

export function activate(host) {
  host.defineApi('status', async () => svc.getStatus());
  host.defineApi('diff', async (params) => svc.getDiff(params));
  host.defineApi('log', async (params) => svc.getLog(params));
  host.defineApi('stage', async (params) => svc.stage(params));
  host.defineApi('unstage', async (params) => svc.unstage(params));
  host.defineApi('commit', async (params) => svc.commit(params));
  host.defineApi('discard', async (params) => svc.discard(params));
}
