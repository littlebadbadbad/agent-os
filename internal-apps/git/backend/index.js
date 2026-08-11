/**
 * internal-apps/git/backend/index.js — Git backend app
 *
 * Registers all Git API methods via host.defineApi().
 * Command execution goes through the terminal app's cross-app service.
 */

import { createGitService } from './services/git.js';

/** @import { BackendAppHost } from '@agent-type/app.ts' */

/**
 * Activate the git app backend.
 *
 * Resolves the terminal cross-app service for command execution.
 * Throws if the terminal app is not available — git cannot function
 * without it.
 *
 * @param {BackendAppHost} host
 */
export function activate(host) {
  const terminal = host.services.resolve('terminal');
  if (!terminal) {
    throw new Error('[git] Cannot activate: terminal service not available. Ensure the terminal app is enabled.');
  }

  const svc = createGitService(terminal);

  host.defineApi('status', async () => svc.getStatus());
  host.defineApi('diff', async (params) => svc.getDiff(params));
  host.defineApi('log', async (params) => svc.getLog(params));
  host.defineApi('stage', async (params) => svc.stage(params));
  host.defineApi('unstage', async (params) => svc.unstage(params));
  host.defineApi('commit', async (params) => svc.commit(params));
  host.defineApi('discard', async (params) => svc.discard(params));
}
