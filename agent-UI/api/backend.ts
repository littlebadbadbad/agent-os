/**
 * agent-UI/api/backend.ts — Backend API adapter for agent-related services
 *
 * PURE BUSINESS LOGIC — ZERO communication code.
 * All HTTP/IPC details delegated to apiTransport.
 */

import { apiTransport } from '../transport/apiTransport';
import type { SessionEntryData } from '@agent-sdk';

// ── Public key ────────────────────────────────────────────────────────────────

export async function fetchPublicKey(): Promise<{ publicKey: string }> {
  return apiTransport.get<{ publicKey: string }>('/api/public-key');
}

// ── API keys ──────────────────────────────────────────────────────────────────

export interface MaskedKeys {
  keys: Record<string, string | null>;
}

export async function fetchApiKeys(): Promise<MaskedKeys> {
  return apiTransport.get<MaskedKeys>('/api/api-keys');
}

export async function saveApiKey(providerId: string, encryptedKey: string): Promise<{ masked: string }> {
  return apiTransport.post<{ masked: string; error?: string }>('/api/api-keys', {
    providerId,
    encryptedKey,
  });
}

export async function deleteApiKey(providerId: string): Promise<void> {
  return apiTransport.del(`/api/api-keys/${providerId}`);
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

export async function getProxyConfig(): Promise<{ config: Record<string, unknown> }> {
  return apiTransport.get<{ config: Record<string, unknown> }>('/api/proxy');
}

export async function updateProxyConfig(config: Record<string, unknown>): Promise<void> {
  await apiTransport.put('/api/proxy', config);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function loadSessions(agentId: string): Promise<SessionEntryData[]> {
  try {
    const res = await apiTransport.get<{ sessions: SessionEntryData[] }>(
      `/api/agent-sessions/${encodeURIComponent(agentId)}`,
    );
    return Array.isArray(res.sessions) ? res.sessions : [];
  } catch {
    return [];
  }
}

export async function saveSessions(agentId: string, sessions: SessionEntryData[]): Promise<void> {
  try {
    await apiTransport.put(`/api/agent-sessions/${encodeURIComponent(agentId)}`, { sessions });
  } catch {
    // best-effort
  }
}
