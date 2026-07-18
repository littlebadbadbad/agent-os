/**
 * Tests for backend/lib/key-store.js — Runtime API key storage
 *
 * Covers getApiKey, setApiKey, deleteApiKey, listApiKeys.
 * Mocks fs for persistence operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs & logger ──────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../lib/paths.js', () => ({
  AGENT_DIR: '/mock/agent',
}));

// Mock key-encryption to return a predictable round-trip
vi.mock('../lib/key-encryption.js', () => ({
  encrypt: vi.fn((plain) => `enc:${plain}`),
  decrypt: vi.fn((enc) => {
    if (enc.startsWith('enc:')) return enc.slice(4);
    return null;
  }),
}));

import { readFileSync, writeFileSync, existsSync } from 'fs';

beforeEach(() => {
  vi.clearAllMocks();
  // Start with no persisted keys
  existsSync.mockReturnValue(false);
  // Reset module registry so each importKeyStore() gets a fresh module
  vi.resetModules();
});

// Re-import module fresh for each test to reset the in-memory _keys map
async function importKeyStore() {
  const mod = await import('../lib/key-store.js');
  return mod;
}

describe('key-store', () => {
  it('returns null for unset key', async () => {
    const { getApiKey } = await importKeyStore();
    expect(getApiKey('nonexistent')).toBeNull();
  });

  it('stores and retrieves a key', async () => {
    const { getApiKey, setApiKey } = await importKeyStore();
    setApiKey('my-provider', 'sk-test-key');
    expect(getApiKey('my-provider')).toBe('sk-test-key');
  });

  it('persists keys to file on set', async () => {
    const { setApiKey } = await importKeyStore();
    setApiKey('my-provider', 'sk-test-key');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written['my-provider']).toBe('enc:sk-test-key');
  });

  it('deletes a key', async () => {
    const { getApiKey, setApiKey, deleteApiKey } = await importKeyStore();
    setApiKey('my-provider', 'sk-test-key');
    deleteApiKey('my-provider');
    expect(getApiKey('my-provider')).toBeNull();
  });

  it('deleting triggers persistence', async () => {
    const { setApiKey, deleteApiKey } = await importKeyStore();
    setApiKey('my-provider', 'sk-test-key');
    writeFileSync.mockClear();
    deleteApiKey('my-provider');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('falls through to env var', async () => {
    const prev = process.env.MY_PROVIDER_API_KEY;
    process.env.MY_PROVIDER_API_KEY = 'env-key-value';
    const { getApiKey } = await importKeyStore();
    // Dynamic provider names use the <NAME>_API_KEY convention
    expect(getApiKey('my-provider')).toBe('env-key-value');
    process.env.MY_PROVIDER_API_KEY = prev;
  });

  it('falls through to canonical env var for known providers', async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'deepseek-env-key';
    const { getApiKey } = await importKeyStore();
    expect(getApiKey('deepseek')).toBe('deepseek-env-key');
    process.env.DEEPSEEK_API_KEY = prev;
  });

  it('runtime key takes precedence over env var', async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'env-key';
    const { getApiKey, setApiKey } = await importKeyStore();
    setApiKey('deepseek', 'runtime-key');
    expect(getApiKey('deepseek')).toBe('runtime-key');
    process.env.DEEPSEEK_API_KEY = prev;
  });

  it('listApiKeys returns masked key info', async () => {
    const { listApiKeys, setApiKey } = await importKeyStore();
    setApiKey('prov-a', 'abcdef123456');
    const keys = listApiKeys();
    expect(keys['prov-a']).toBe('••••3456');
  });

  it('listApiKeys includes known env var keys', async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'my-secret-key-9999';
    const { listApiKeys } = await importKeyStore();
    const keys = listApiKeys();
    expect(keys['deepseek']).toBe('••••9999');
    process.env.DEEPSEEK_API_KEY = prev;
  });

  it('loads persisted keys from file on init', async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ 'my-provider': 'enc:persisted-key' }));
    const { getApiKey } = await importKeyStore();
    expect(getApiKey('my-provider')).toBe('persisted-key');
  });

  it('handles corrupted persisted file gracefully', async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('not-json');
    const { getApiKey } = await importKeyStore();
    // Should not throw
    expect(getApiKey('any')).toBeNull();
  });
});
