/**
 * Tests for backend/transports/ipc/api.js — Demo-API IPC handlers
 *
 * Pure protocol-layer passthrough.
 *   api:models:list      → provider.listModels()
 *   api:public-key       → systemService.getPublicKeyInfo()
 *   api:api-keys:list    → key-store.listApiKeys()
 *   api:api-keys:save    → decryptPat() → setApiKey()
 *   api:api-keys:delete  → deleteApiKey()
 *   api:health           → systemService.checkHealth()
 *   api:proxy:get        → proxyService.getConfig()
 *   api:proxy:update     → proxyService.updateConfig()
 *   api:proxy:test       → proxyService.testProxyTarget()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock ───────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockProviders = vi.hoisted(() => ({
  qwen:     { listModels: vi.fn() },
  doubao:   { listModels: vi.fn() },
  deepseek: { listModels: vi.fn() },
  glm:      { listModels: vi.fn() },
  openai:   { listModels: vi.fn() },
}));

const mockSystemService = vi.hoisted(() => ({
  getPublicKeyInfo: vi.fn(),
  checkHealth: vi.fn(),
}));

const mockKeyStore = vi.hoisted(() => ({
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}));

const mockProxyService = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  testProxyTarget: vi.fn(),
}));

const mockRsa = vi.hoisted(() => ({
  decryptPat: vi.fn(),
}));

const mockModelConfigService = vi.hoisted(() => ({
  getMergedConfig: vi.fn(),
  getBuiltInConfig: vi.fn(),
  getCustomConfig: vi.fn(),
  saveCustomConfig: vi.fn(),
  addCustomProvider: vi.fn(),
  removeCustomProvider: vi.fn(),
  updateCustomProvider: vi.fn(),
  getMergedProvider: vi.fn(),
  getMergedModelConfig: vi.fn(),
  listMergedProviderNames: vi.fn(() => ['doubao', 'deepseek', 'qwen', 'glm', 'openai']),
  listMergedModelsForProvider: vi.fn(),
}));

const mockApiKeysService = vi.hoisted(() => ({
  getKeyList: vi.fn(),
  saveKey: vi.fn(),
  removeKey: vi.fn(),
}));

const mockModelsService = vi.hoisted(() => ({
  listModels: vi.fn(),
}));

vi.mock('../providers/qwen.js',     () => ({ listModels: (...a) => mockProviders.qwen.listModels(...a) }));
vi.mock('../providers/doubao.js',   () => ({ listModels: (...a) => mockProviders.doubao.listModels(...a) }));
vi.mock('../providers/deepseek.js', () => ({ listModels: (...a) => mockProviders.deepseek.listModels(...a) }));
vi.mock('../providers/glm.js',      () => ({ listModels: (...a) => mockProviders.glm.listModels(...a) }));
vi.mock('../providers/openai.js',   () => ({ listModels: (...a) => mockProviders.openai.listModels(...a) }));
vi.mock('../services/system.js', () => mockSystemService);
vi.mock('../lib/key-store.js',       () => mockKeyStore);
vi.mock('../services/proxy.js',           () => mockProxyService);
vi.mock('../lib/rsa.js',             () => mockRsa);
vi.mock('../services/models.js', () => mockModelsService);
vi.mock('../services/api-keys.js', () => mockApiKeysService);
vi.mock('../services/model-config.js', () => mockModelConfigService);

import { registerApiHandlers } from '../transports/ipc/api.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function createMockIpcMain() {
  const handlers = {};
  return {
    _handlers: handlers,
    handle(channel, fn) { handlers[channel] = fn; },
  };
}

function makeEvent() {
  return { sender: { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) } };
}

let ipcMain;

beforeEach(() => {
  vi.clearAllMocks();
  ipcMain = createMockIpcMain();
  registerApiHandlers(ipcMain);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('api:models:list', () => {
  const MODELS = [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', url: 'https://api.example.com/v1', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 8192 }];

  it('lists models for a valid provider', async () => {
    mockModelsService.listModels.mockResolvedValue({ provider: 'DeepSeek', models: MODELS });

    const result = await ipcMain._handlers['api:models:list'](makeEvent(), { provider: 'DeepSeek' });

    expect(result).toEqual({ provider: 'DeepSeek', models: MODELS });
  });

  it('throws when provider is missing', async () => {
    mockModelsService.listModels.mockRejectedValue(new Error('Missing required param: provider'));

    await expect(
      ipcMain._handlers['api:models:list'](makeEvent(), {}),
    ).rejects.toThrow(/provider/);
  });

  it('throws for unknown provider', async () => {
    mockModelsService.listModels.mockRejectedValue(new Error('Unknown provider "unknown"'));

    await expect(
      ipcMain._handlers['api:models:list'](makeEvent(), { provider: 'unknown' }),
    ).rejects.toThrow(/unknown/i);
  });
});

// ── Public key ────────────────────────────────────────────────────────────────

describe('api:public-key', () => {
  it('returns public key info from system service', async () => {
    mockSystemService.getPublicKeyInfo.mockResolvedValue({ publicKey: 'pem-content' });

    const result = await ipcMain._handlers['api:public-key'](makeEvent(), {});
    expect(result).toEqual({ publicKey: 'pem-content' });
    expect(mockSystemService.getPublicKeyInfo).toHaveBeenCalledOnce();
  });
});

// ── API keys ──────────────────────────────────────────────────────────────────

describe('api:api-keys:*', () => {
  it('api:api-keys:list returns keys from key-store', async () => {
    mockApiKeysService.getKeyList.mockReturnValue({ keys: { doubao: '••••k1', qwen: null } });

    const result = await ipcMain._handlers['api:api-keys:list'](makeEvent(), {});
    expect(result).toEqual({ keys: { doubao: '••••k1', qwen: null } });
  });

  it('api:api-keys:save decrypts and stores the key', async () => {
    mockApiKeysService.saveKey.mockReturnValue({ ok: true, masked: '••••key1' });

    const result = await ipcMain._handlers['api:api-keys:save'](makeEvent(), {
      providerId: 'doubao',
      encryptedKey: 'encrypted-base64',
    });

    expect(mockApiKeysService.saveKey).toHaveBeenCalledWith('doubao', 'encrypted-base64');
    expect(result.ok).toBe(true);
    expect(result.masked).toMatch(/^••••/);
  });

  it('api:api-keys:save throws for invalid providerId', async () => {
    mockApiKeysService.saveKey.mockImplementation(() => { throw new Error('Invalid providerId'); });

    await expect(
      ipcMain._handlers['api:api-keys:save'](makeEvent(), { providerId: 'unknown', encryptedKey: 'x' }),
    ).rejects.toThrow(/Invalid providerId/);
  });

  it('api:api-keys:save throws for missing encryptedKey', async () => {
    mockApiKeysService.saveKey.mockImplementation(() => { throw new Error('encryptedKey is required'); });

    await expect(
      ipcMain._handlers['api:api-keys:save'](makeEvent(), { providerId: 'doubao' }),
    ).rejects.toThrow(/encryptedKey is required/);
  });

  it('api:api-keys:save throws when decryption fails', async () => {
    mockApiKeysService.saveKey.mockImplementation(() => { throw new Error('Failed to decrypt'); });

    await expect(
      ipcMain._handlers['api:api-keys:save'](makeEvent(), { providerId: 'doubao', encryptedKey: 'bad' }),
    ).rejects.toThrow(/Failed to decrypt/);
  });

  it('api:api-keys:delete removes the key', async () => {
    mockApiKeysService.removeKey.mockReturnValue({ ok: true });

    const result = await ipcMain._handlers['api:api-keys:delete'](makeEvent(), { providerId: 'doubao' });
    expect(mockApiKeysService.removeKey).toHaveBeenCalledWith('doubao');
    expect(result).toEqual({ ok: true });
  });

  it('api:api-keys:delete throws for invalid providerId', async () => {
    mockApiKeysService.removeKey.mockImplementation(() => { throw new Error('Invalid providerId'); });

    await expect(
      ipcMain._handlers['api:api-keys:delete'](makeEvent(), { providerId: 'unknown' }),
    ).rejects.toThrow(/Invalid providerId/);
  });
});

// ── Health ────────────────────────────────────────────────────────────────────

describe('api:health', () => {
  it('returns health status from system service', async () => {
    mockSystemService.checkHealth.mockResolvedValue({ status: 'ok' });

    const result = await ipcMain._handlers['api:health'](makeEvent(), {});
    expect(result).toEqual({ status: 'ok' });
  });
});

// ── Proxy ─────────────────────────────────────────────────────────────────────

describe('api:proxy:*', () => {
  it('api:proxy:get returns proxy config', async () => {
    mockProxyService.getConfig.mockReturnValue({ host: 'localhost', port: 7890 });

    const result = await ipcMain._handlers['api:proxy:get'](makeEvent(), {});
    expect(result).toEqual({ config: { host: 'localhost', port: 7890 } });
  });

  it('api:proxy:update sets and returns config', async () => {
    mockProxyService.updateConfig.mockReturnValue({ config: { host: '10.0.0.1', port: 8888 } });

    const result = await ipcMain._handlers['api:proxy:update'](makeEvent(), { host: '10.0.0.1', port: 8888 });
    expect(mockProxyService.updateConfig).toHaveBeenCalledWith({ host: '10.0.0.1', port: 8888 });
    expect(result).toEqual({ config: { host: '10.0.0.1', port: 8888 } });
  });

  it('api:proxy:test returns test result', async () => {
    mockProxyService.testProxyTarget.mockResolvedValue({ ok: true, ms: 42 });

    const result = await ipcMain._handlers['api:proxy:test'](makeEvent(), { target: 'https://example.com' });
    expect(mockProxyService.testProxyTarget).toHaveBeenCalledWith('https://example.com', undefined);
    expect(result).toEqual({ ok: true, ms: 42, error: undefined });
  });

  it('api:proxy:test passes overrides when present', async () => {
    mockProxyService.testProxyTarget.mockResolvedValue({ ok: false, error: 'timeout' });

    const result = await ipcMain._handlers['api:proxy:test'](makeEvent(), {
      target: 'https://example.com',
      host: 'override-host',
      port: 9999,
    });
    expect(mockProxyService.testProxyTarget).toHaveBeenCalledWith('https://example.com', { host: 'override-host', port: 9999 });
    expect(result).toEqual({ ok: false, error: 'timeout' });
  });
});

// ── Model config (built-in + custom merge) ────────────────────────────────────

describe('api:model-config:*', () => {
  it('api:model-config:get returns the merged config', async () => {
    const mockConfig = [
      { name: 'DeepSeek', vendor: 'customendpoint', apiKey: '${input:secret}', apiType: 'chat-completions', models: [] },
    ];
    mockModelConfigService.getMergedConfig.mockReturnValue(mockConfig);

    const result = await ipcMain._handlers['api:model-config:get'](makeEvent(), {});
    expect(result).toEqual(mockConfig);
  });

  it('api:model-config:built-in returns built-in config', async () => {
    mockModelConfigService.getBuiltInConfig.mockReturnValue([]);
    const result = await ipcMain._handlers['api:model-config:built-in'](makeEvent(), {});
    expect(result).toEqual([]);
  });

  it('api:model-config:custom:get returns custom config', async () => {
    mockModelConfigService.getCustomConfig.mockReturnValue([]);
    const result = await ipcMain._handlers['api:model-config:custom:get'](makeEvent(), {});
    expect(result).toEqual([]);
  });

  it('api:model-config:custom:save writes the custom config', async () => {
    const mockConfig = [{ name: 'MyProvider', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [] }];
    mockModelConfigService.saveCustomConfig.mockReturnValue(undefined);

    const result = await ipcMain._handlers['api:model-config:custom:save'](makeEvent(), mockConfig);
    expect(mockModelConfigService.saveCustomConfig).toHaveBeenCalledWith(mockConfig);
    expect(result).toEqual({ ok: true });
  });

  it('api:model-config:custom:add adds a custom provider entry', async () => {
    const entry = { name: 'NewProv', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [{ id: 'm1' }] };
    mockModelConfigService.addCustomProvider.mockReturnValue(undefined);

    const result = await ipcMain._handlers['api:model-config:custom:add'](makeEvent(), entry);
    expect(mockModelConfigService.addCustomProvider).toHaveBeenCalledWith(entry);
    expect(result).toEqual({ ok: true });
  });

  it('api:model-config:custom:remove removes a custom provider by name', async () => {
    mockModelConfigService.removeCustomProvider.mockReturnValue(undefined);

    const result = await ipcMain._handlers['api:model-config:custom:remove'](makeEvent(), { name: 'DeepSeek' });
    expect(mockModelConfigService.removeCustomProvider).toHaveBeenCalledWith('DeepSeek');
    expect(result).toEqual({ ok: true });
  });

  it('api:model-config:custom:update updates a custom provider', async () => {
    const entry = { name: 'DeepSeek', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [{ id: 'm1' }] };
    mockModelConfigService.updateCustomProvider.mockReturnValue(undefined);

    const result = await ipcMain._handlers['api:model-config:custom:update'](makeEvent(), { name: 'DeepSeek', entry });
    expect(mockModelConfigService.updateCustomProvider).toHaveBeenCalledWith('DeepSeek', entry);
    expect(result).toEqual({ ok: true });
  });
});
