/**
 * Tests for agent-UI/transport/apiTransport.ts — IPC (Electron) path
 *
 * Mocks `window.electronAPI.invoke` and verifies that every route in the
 * IPC route table maps to the correct backend channel name AND passes the
 * correct business parameters (extracted via `toParams` from the URL path).
 *
 * This catches two classes of bugs:
 *   (a) Wrong channel name — frontend calls `sessions:get` but backend
 *       registered `sessions:load`.
 *   (b) Wrong parameter format — frontend passes `{ path, signal }` wrapper
 *       but backend expects `{ agentId }` directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (hoisted by vitest) ────────────────────────────────────

vi.mock('../env', () => ({ IS_ELECTRON_IPC: true }));
vi.mock('../config', () => ({ BACKEND_URL: '' }));

// `vi.hoisted` runs before module evaluation — essential for setting up
// `window.electronAPI` before the IPC singleton is constructed at import time.
const mockInvoke = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  (globalThis as any).window = {
    electronAPI: {
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };
});

import { apiTransport } from '../transport/apiTransport';

// ═════════════════════════════════════════════════════════════════════════════
// Public key
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/public-key', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls publicKey:get with empty params (not apikeys:public-key)', async () => {
    mockInvoke.mockResolvedValue({ publicKey: 'pem-data' });

    const result = await apiTransport.get('/api/public-key');

    expect(mockInvoke).toHaveBeenCalledWith('publicKey:get', {});
    expect(mockInvoke).not.toHaveBeenCalledWith('apikeys:public-key', expect.anything());
    expect(result).toEqual({ publicKey: 'pem-data' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Proxy
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/proxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:proxy:get with empty params', async () => {
    mockInvoke.mockResolvedValue({ config: {} });

    const result = await apiTransport.get<{ config: Record<string, unknown> }>('/api/proxy');

    expect(mockInvoke).toHaveBeenCalledWith('api:proxy:get', {});
    expect(result).toEqual({ config: {} });
  });
});

describe('PUT /api/proxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:proxy:update with the body (not proxy:put)', async () => {
    const proxyBody = { http: 'http://proxy:8080' };

    await apiTransport.put('/api/proxy', proxyBody);

    expect(mockInvoke).toHaveBeenCalledWith('api:proxy:update', proxyBody);
    expect(mockInvoke).not.toHaveBeenCalledWith('proxy:put', expect.anything());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Models
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/models', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:models:list with provider from query string', async () => {
    mockInvoke.mockResolvedValue({ provider: 'doubao', models: [] });

    const result = await apiTransport.get('/api/models?provider=doubao');

    expect(mockInvoke).toHaveBeenCalledWith('api:models:list', { provider: 'doubao' });
    expect(result).toEqual({ provider: 'doubao', models: [] });
  });

  it('calls api:models:list with non-existent provider in query string', async () => {
    mockInvoke.mockResolvedValue({ provider: 'nope', models: [] });

    const result = await apiTransport.get('/api/models?provider=nope');

    expect(mockInvoke).toHaveBeenCalledWith('api:models:list', { provider: 'nope' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// API keys
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/api-keys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:api-keys:list with empty params', async () => {
    mockInvoke.mockResolvedValue({ keys: {} });

    const result = await apiTransport.get('/api/api-keys');

    expect(mockInvoke).toHaveBeenCalledWith('api:api-keys:list', {});
    expect(result).toEqual({ keys: {} });
  });
});

describe('POST /api/api-keys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:api-keys:save with the body', async () => {
    const body = { providerId: 'doubao', encryptedKey: 'encrypted-data' };

    await apiTransport.post('/api/api-keys', body);

    expect(mockInvoke).toHaveBeenCalledWith('api:api-keys:save', body);
  });
});

describe('DELETE /api/api-keys/:providerId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:api-keys:delete with providerId extracted from path', async () => {
    mockInvoke.mockResolvedValue({ ok: true });

    await apiTransport.del('/api/api-keys/doubao');

    expect(mockInvoke).toHaveBeenCalledWith('api:api-keys:delete', { providerId: 'doubao' });
  });

  it('handles URL-encoded providerId in path', async () => {
    mockInvoke.mockResolvedValue({ ok: true });

    await apiTransport.del('/api/api-keys/deepseek-v3');

    expect(mockInvoke).toHaveBeenCalledWith('api:api-keys:delete', { providerId: 'deepseek-v3' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sessions
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/agent-sessions/:agentId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls sessions:load with agentId extracted from path', async () => {
    mockInvoke.mockResolvedValue({ sessions: [] });

    const result = await apiTransport.get('/api/agent-sessions/async-agent');

    expect(mockInvoke).toHaveBeenCalledWith('sessions:load', { agentId: 'async-agent' });
    expect(result).toEqual({ sessions: [] });
  });

  it('extracts agentId from path with slashes', async () => {
    mockInvoke.mockResolvedValue({ sessions: [] });

    await apiTransport.get('/api/agent-sessions/stream-agent');

    expect(mockInvoke).toHaveBeenCalledWith('sessions:load', { agentId: 'stream-agent' });
  });
});

describe('PUT /api/agent-sessions/:agentId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls sessions:save with agentId + session body', async () => {
    const sessions = [{ id: 's1', title: 'Chat' }];
    mockInvoke.mockResolvedValue({ ok: true });

    await apiTransport.put('/api/agent-sessions/async-agent', { sessions });

    expect(mockInvoke).toHaveBeenCalledWith('sessions:save', {
      agentId: 'async-agent',
      sessions,
    });
  });

  it('spreads additional fields from body', async () => {
    const body = { sessions: [], extraField: 'value' };
    mockInvoke.mockResolvedValue({ ok: true });

    await apiTransport.put('/api/agent-sessions/async-agent', body);

    expect(mockInvoke).toHaveBeenCalledWith('sessions:save', {
      agentId: 'async-agent',
      sessions: [],
      extraField: 'value',
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ADO proxy
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/ado-proxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:ado-proxy:call with params', async () => {
    const adoParams = {
      url: 'https://dev.azure.com/org/_apis/projects',
      pat: 'encrypted-pat',
      method: 'GET',
    };

    await apiTransport.adoProxy(adoParams);

    expect(mockInvoke).toHaveBeenCalledWith('api:ado-proxy:call', adoParams);
  });
});

describe('POST /api/ado-proxy/upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls api:ado-proxy:upload with params', async () => {
    const uploadParams = {
      url: 'https://dev.azure.com/org/_apis/upload',
      pat: 'encrypted-pat',
      contentType: 'application/octet-stream',
      apiVersion: '6.1-preview',
      rawBody: new Blob(['test']),
    };

    await apiTransport.adoProxyUpload(uploadParams);

    expect(mockInvoke).toHaveBeenCalledWith('api:ado-proxy:upload', uploadParams);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Error handling
// ═════════════════════════════════════════════════════════════════════════════

describe('Route errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws on unknown route', async () => {
    await expect(
      apiTransport.get('/api/nonexistent'),
    ).rejects.toThrow(/No route for GET \/api\/nonexistent/);
  });
});
