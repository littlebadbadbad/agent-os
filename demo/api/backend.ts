/**
 * demo/api/backend.ts — Backend API adapter (DevOps-specific)
 *
 * PURE BUSINESS LOGIC — ZERO communication code.
 * All HTTP/IPC details delegated to apiTransport.
 */

import { apiTransport } from '../transport';

// ── Health ────────────────────────────────────────────────────────────────────

export async function checkHealth(signal?: AbortSignal): Promise<{ status: string }> {
  return apiTransport.get<{ status: string }>('/api/health', signal);
}

// ── ADO proxy ─────────────────────────────────────────────────────────────────

export { apiTransport as adoTransport };
