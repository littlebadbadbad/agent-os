/**
 * internal-apps/devops/backend/index.js — DevOps backend app entry
 *
 * Registers ADO proxy API methods via BackendAppHost.defineApi().
 * The decrypt function is obtained from the host at activation time.
 */

import { createAdoProxyService } from './services/ado-proxy.js';

/** @import { BackendAppHost } from '../../../../agent-type/app.ts' */

/**
 * Activate the devops backend app.
 *
 * @param {BackendAppHost} host
 */
export function activate(host) {
  const decryptPat = host.getBackendConfig('rsaDecrypt');
  if (typeof decryptPat !== 'function') {
    throw new Error('[devops] Backend config "rsaDecrypt" not available — cannot decrypt PAT tokens.');
  }

  const svc = createAdoProxyService({
    decryptFn: decryptPat,
    logger: host.logger,
  });

  // ── ADO proxy ────────────────────────────────────────────────────────────
  host.defineApi('getPublicKey', async () => {
    const publicKey = host.getBackendConfig('rsaPublicKey');
    return { key: publicKey };
  });

  host.defineApi('callAdoProxy', async (params) => {
    const { url, pat, method = 'GET', body, contentType, apiVersion } = params || {};
    return svc.callAdoProxy({ url, pat, method, body, contentType, apiVersion });
  });

  host.defineApi('uploadAdoProxy', async (params) => {
    const { url, pat, contentType, apiVersion, rawBody } = params || {};
    return svc.uploadAdoProxy({ url, pat, contentType, apiVersion, rawBody });
  });
}
