// ADO HTTP client — low-level fetch wrapper and shared raw response types
//
// PURE BUSINESS LOGIC — ZERO direct fetch() calls.
// All HTTP communication delegated to apiTransport.adoProxy / .adoProxyUpload.
import { encryptPat, clearPublicKeyCache } from '../utils/patEncryption';
import { apiTransport } from '../transport';

const API_VERSION = '6.1-preview';

export const WORK_ITEM_FIELDS = [
  // System
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AssignedTo',
  'System.IterationPath',
  'System.AreaPath',
  'System.Tags',
  // Common
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Common.Severity',
  'Microsoft.VSTS.Common.Activity',
  'Microsoft.VSTS.Common.BusinessValue',
  'Microsoft.VSTS.Common.ValueArea',
  // Scheduling
  'Microsoft.VSTS.Scheduling.Effort',
  'Microsoft.VSTS.Scheduling.OriginalEstimate',
  'Microsoft.VSTS.Scheduling.RemainingWork',
  'Microsoft.VSTS.Scheduling.CompletedWork',
  'Microsoft.VSTS.Scheduling.StoryPoints',
  'Microsoft.VSTS.Scheduling.StartDate',
  'Microsoft.VSTS.Scheduling.FinishDate',
  'Microsoft.VSTS.Scheduling.TargetDate',
];


// ── Generic ADO proxy wrapper ─────────────────────────────────────────────────
// All ADO traffic is routed through the backend proxy (/api/ado-proxy) to avoid
// browser CORS restrictions.  The backend forwards the request to ADO using its
// own fetch (which also respects any configured network proxy).
// Communication is handled by apiTransport — completely separated from logic.

export async function adoFetch<T>(
  url: string,
  pat: string,
  opts: { method?: string; body?: unknown; rawBody?: BodyInit; contentType?: string; apiVersion?: string } = {},
): Promise<T> {
  const method = opts.method ?? 'GET';

  // Encrypt the PAT with the server's RSA public key before it leaves the browser.
  // On a "Failed to decrypt" 400 error we clear the cached key and re-encrypt once
  // (handles the case where the server restarted with a new key pair).
  const encPat = await encryptPat(pat);

  try {
    // ── Binary upload path ──────────────────────────────────────────────────
    if (opts.rawBody !== undefined) {
      return await apiTransport.adoProxyUpload<T>({
        url,
        pat: encPat,
        contentType: opts.contentType ?? 'application/octet-stream',
        apiVersion: opts.apiVersion ?? API_VERSION,
        rawBody: opts.rawBody,
      });
    }

    // ── Standard JSON path ──────────────────────────────────────────────────
    return await apiTransport.adoProxy<T>({
      url,
      pat: encPat,
      method,
      body: opts.body,
      contentType: opts.contentType,
      apiVersion: opts.apiVersion ?? API_VERSION,
    });
  } catch (err) {
    // On a "Failed to decrypt" 400 error, clear cached key and re-throw
    const msg = (err as Error).message;
    if (msg.includes('decrypt PAT')) {
      clearPublicKeyCache();
    }
    throw err;
  }
}
