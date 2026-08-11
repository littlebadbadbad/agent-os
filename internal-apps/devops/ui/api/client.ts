// ADO HTTP client — low-level fetch wrapper and shared raw response types
//
// PURE BUSINESS LOGIC — ZERO direct fetch() calls.
// All HTTP communication delegated to AppApiClient.call (backend app).
import { encryptPat, clearPublicKeyCache } from '../utils/patEncryption';
import type { AppApiClient } from '@agent-type';

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

// ── Injectable API client ─────────────────────────────────────────────────────
// Set during bootApp() in main.tsx — before that, calling adoFetch throws.

let apiClient: AppApiClient | null = null;

export function setApiClient(client: AppApiClient): void {
  apiClient = client;
}

function requireClient(): AppApiClient {
  if (!apiClient) {
    throw new Error(
      '[devops-api] AppApiClient not set. Call setApiClient(host.apiClient) during boot.',
    );
  }
  return apiClient;
}

// ── Generic ADO proxy wrapper ─────────────────────────────────────────────────
// All ADO traffic is routed through the backend app's defineApi handler,
// which decrypts the PAT and forwards the request to ADO.

export async function adoFetch<T>(
  url: string,
  pat: string,
  opts: { method?: string; body?: unknown; rawBody?: BodyInit; contentType?: string; apiVersion?: string } = {},
): Promise<T> {
  const client = requireClient();
  const method = opts.method ?? 'GET';

  // Encrypt the PAT with the server's RSA public key before it leaves the browser.
  // On a "Failed to decrypt" error we clear the cached key and re-encrypt once
  // (handles the case where the server restarted with a new key pair).
  const encPat = await encryptPat(pat, client);

  try {
    // ── Binary upload path ──────────────────────────────────────────────────
    if (opts.rawBody !== undefined) {
      return await client.call<T>('uploadAdoProxy', {
        url,
        pat: encPat,
        contentType: opts.contentType ?? 'application/octet-stream',
        apiVersion: opts.apiVersion ?? API_VERSION,
        rawBody: opts.rawBody,
      } as Record<string, unknown>);
    }

    // ── Standard JSON path ──────────────────────────────────────────────────
    return await client.call<T>('callAdoProxy', {
      url,
      pat: encPat,
      method,
      body: opts.body,
      contentType: opts.contentType,
      apiVersion: opts.apiVersion ?? API_VERSION,
    } as Record<string, unknown>);
  } catch (err) {
    // On a "Failed to decrypt" error, clear cached key and re-throw
    const msg = (err as Error).message;
    if (msg.includes('decrypt PAT')) {
      clearPublicKeyCache();
    }
    throw err;
  }
}


