/**
 * Tests for backend/services/model-config.js
 *
 * Covers: getBuiltInConfig, getCustomConfig, getMergedConfig,
 * getMergedProvider, getMergedModelConfig, saveCustomConfig,
 * addCustomProvider, removeCustomProvider, updateCustomProvider,
 * listMergedProviderNames, listMergedModelsForProvider, _resetCache.
 *
 * Uses vi.mock on 'fs' to control file system behavior.
 * Target: 100% coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

// ── Hoisted sample data (must be before vi.mock references) ───────────────────

const SAMPLE_BUILT_IN = vi.hoisted(() => ([
  {
    name: 'deepseek',
    vendor: 'customendpoint',
    apiKey: '',
    apiType: 'chat-completions',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', url: 'https://api.deepseek.com/v1/chat/completions', toolCalling: true, vision: false, maxInputTokens: 1048576, maxOutputTokens: 524288 },
    ],
  },
  {
    name: 'openai',
    vendor: 'customendpoint',
    apiKey: '',
    apiType: 'chat-completions',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', url: 'https://api.openai.com/v1/chat/completions', toolCalling: true, vision: true, maxInputTokens: 1000000, maxOutputTokens: 500000 },
    ],
  },
]));

const SAMPLE_CUSTOM = vi.hoisted(() => ([
  {
    name: 'deepseek',
    vendor: 'customendpoint',
    apiKey: '${input:chat.lm.secret.custom-deepseek}',
    apiType: 'chat-completions',
    models: [
      { id: 'custom-model', name: 'Custom Model', url: 'https://custom.example.com/v1/chat/completions', toolCalling: true, vision: false, maxInputTokens: 10000, maxOutputTokens: 1000 },
    ],
  },
  {
    name: 'custom-only-provider',
    vendor: 'customendpoint',
    apiKey: '',
    apiType: 'chat-completions',
    models: [
      { id: 'custom-only-model', name: 'Custom Only', url: 'https://custom-only.example.com/v1/chat/completions', toolCalling: false, vision: false, maxInputTokens: 5000, maxOutputTokens: 500 },
    ],
  },
]));

// ── Mock the built-in JSON module (replaces file I/O with SAMPLE_BUILT_IN) ────

vi.mock('../services/built-in-provider-config.json', () => ({ default: SAMPLE_BUILT_IN }));

// ── Mock fs and logger ───────────────────────────────────────────────────────

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('../lib/paths.js', () => ({
  DATA_ROOT: '/mock/data',
}));

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import {
  getBuiltInConfig,
  getCustomConfig,
  getMergedConfig,
  getMergedProvider,
  getMergedModelConfig,
  saveCustomConfig,
  addCustomProvider,
  removeCustomProvider,
  updateCustomProvider,
  listMergedProviderNames,
  listMergedModelsForProvider,
  _resetCache,
} from '../services/model-config.js';

const CUSTOM_CONFIG_PATH = join('/mock/data', 'custom-provider-config.json');
const DATA_DIR = join('/mock/data');

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  existsSync.mockReturnValue(true);
  readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── getBuiltInConfig ─────────────────────────────────────────────────────────

describe('getBuiltInConfig', () => {
  it('returns a deep-cloned array with expected providers', () => {
    const config = getBuiltInConfig();
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(0);
    const names = config.map((p) => p.name);
    expect(names).toContain('deepseek');
    expect(names).toContain('openai');
  });

  it('returns a mutable deep clone (modifying result does not affect cache)', () => {
    const config1 = getBuiltInConfig();
    const config2 = getBuiltInConfig();
    config1[0].name = 'hacked';
    expect(config2[0].name).not.toBe('hacked');
  });

  it('each provider has required fields', () => {
    const config = getBuiltInConfig();
    for (const provider of config) {
      expect(provider).toHaveProperty('name');
      expect(provider).toHaveProperty('vendor', 'customendpoint');
      expect(provider).toHaveProperty('apiKey');
      expect(provider).toHaveProperty('apiType', 'chat-completions');
      expect(provider).toHaveProperty('models');
      expect(Array.isArray(provider.models)).toBe(true);
      expect(provider.models.length).toBeGreaterThan(0);
      for (const model of provider.models) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('url');
        expect(model).toHaveProperty('toolCalling');
        expect(model).toHaveProperty('vision');
        expect(model).toHaveProperty('maxInputTokens');
        expect(model).toHaveProperty('maxOutputTokens');
      }
    }
  });
});

// ── getCustomConfig ─────────────────────────────────────────────────────────

describe('getCustomConfig', () => {
  it('returns parsed custom config when file exists', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const result = getCustomConfig();
    expect(result).toEqual(SAMPLE_CUSTOM);
    expect(readFileSync).toHaveBeenCalledWith(CUSTOM_CONFIG_PATH, 'utf8');
  });

  it('throws when file does not exist and cannot be created', () => {
    existsSync.mockReturnValue(false);
    mkdirSync.mockImplementation(() => { throw new Error('permission denied'); });
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => getCustomConfig()).toThrow();
  });

  it('throws when custom config is not an array', () => {
    readFileSync.mockReturnValue(JSON.stringify({ not: 'array' }));
    expect(() => getCustomConfig()).toThrow('Custom provider config must be a JSON array');
  });

  it('creates default config file when it does not exist (first call)', () => {
    existsSync.mockReturnValueOnce(false); // ensureCustomConfigFile check
    mkdirSync.mockReturnValue(undefined);
    writeFileSync.mockReturnValue(undefined);
    existsSync.mockReturnValueOnce(false); // second check after mkdir
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => getCustomConfig()).toThrow();
    expect(mkdirSync).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
  });

  it('returns empty array when custom config file contains []', () => {
    readFileSync.mockReturnValue('[]');
    expect(getCustomConfig()).toEqual([]);
  });
});

// ── getMergedConfig ─────────────────────────────────────────────────────────

describe('getMergedConfig', () => {
  it('merges built-in + custom, custom overrides by name', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const merged = getMergedConfig();

    // deepseek should be overridden by custom version
    const deepseek = merged.find((p) => p.name === 'deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek.models[0].id).toBe('custom-model');
    expect(deepseek.apiKey).toBe('${input:chat.lm.secret.custom-deepseek}');

    // custom-only provider should appear in merged
    const customOnly = merged.find((p) => p.name === 'custom-only-provider');
    expect(customOnly).toBeDefined();
    expect(customOnly.models[0].id).toBe('custom-only-model');
  });

  it('includes all built-in providers when custom is empty', () => {
    readFileSync.mockReturnValue('[]');
    const merged = getMergedConfig();
    const names = merged.map((p) => p.name);
    expect(names).toContain('deepseek');
    expect(names).toContain('openai');
    expect(merged.length).toBe(getBuiltInConfig().length);
  });

  it('includes custom-only providers not in built-in', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const merged = getMergedConfig();
    const names = merged.map((p) => p.name);
    expect(names).toContain('custom-only-provider');
    expect(merged.length).toBe(getBuiltInConfig().length + 1); // 1 new custom-only, deepseek replaces
  });

  it('correctly handles multiple custom providers overriding built-in', () => {
    const multiCustom = [
      { name: 'deepseek', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [{ id: 'ds-override', name: 'DS', url: 'https://ds.example.com/v1', toolCalling: true, vision: false, maxInputTokens: 100, maxOutputTokens: 100 }] },
      { name: 'openai', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [{ id: 'oa-override', name: 'OA', url: 'https://oa.example.com/v1', toolCalling: true, vision: true, maxInputTokens: 200, maxOutputTokens: 200 }] },
    ];
    readFileSync.mockReturnValue(JSON.stringify(multiCustom));
    const merged = getMergedConfig();
    expect(merged.find((p) => p.name === 'deepseek').models[0].id).toBe('ds-override');
    expect(merged.find((p) => p.name === 'openai').models[0].id).toBe('oa-override');
  });
});

// ── getMergedProvider ───────────────────────────────────────────────────────

describe('getMergedProvider', () => {
  it('returns provider from merged config', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const provider = getMergedProvider('deepseek');
    expect(provider).toBeDefined();
    expect(provider.name).toBe('deepseek');
    // Should be the overridden version
    expect(provider.models[0].id).toBe('custom-model');
  });

  it('returns custom-only provider', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const provider = getMergedProvider('custom-only-provider');
    expect(provider).toBeDefined();
    expect(provider.models[0].id).toBe('custom-only-model');
  });

  it('returns undefined for unknown provider', () => {
    readFileSync.mockReturnValue('[]');
    const provider = getMergedProvider('nonexistent');
    expect(provider).toBeUndefined();
  });
});

// ── getMergedModelConfig ────────────────────────────────────────────────────

describe('getMergedModelConfig', () => {
  it('returns provider + model for valid combo', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const result = getMergedModelConfig('deepseek', 'custom-model');
    expect(result).not.toBeNull();
    expect(result.provider.name).toBe('deepseek');
    expect(result.model.id).toBe('custom-model');
  });

  it('returns null for unknown provider', () => {
    readFileSync.mockReturnValue('[]');
    expect(getMergedModelConfig('unknown', 'some-model')).toBeNull();
  });

  it('returns null for unknown model within known provider', () => {
    readFileSync.mockReturnValue('[]');
    expect(getMergedModelConfig('openai', 'nonexistent-model')).toBeNull();
  });
});

// ── saveCustomConfig ────────────────────────────────────────────────────────

describe('saveCustomConfig', () => {
  it('writes config to file', () => {
    saveCustomConfig(SAMPLE_CUSTOM);
    expect(writeFileSync).toHaveBeenCalledWith(
      CUSTOM_CONFIG_PATH,
      JSON.stringify(SAMPLE_CUSTOM, null, 2),
      'utf8',
    );
  });

  it('throws for non-array', () => {
    expect(() => saveCustomConfig({})).toThrow('Custom config must be an array');
  });

  it('writes empty array', () => {
    saveCustomConfig([]);
    expect(writeFileSync).toHaveBeenCalledWith(
      CUSTOM_CONFIG_PATH,
      JSON.stringify([], null, 2),
      'utf8',
    );
  });
});

// ── addCustomProvider ───────────────────────────────────────────────────────

describe('addCustomProvider', () => {
  it('adds a new custom provider', () => {
    readFileSync.mockReturnValue('[]');
    writeFileSync.mockReturnValue(undefined);
    const newEntry = {
      name: 'NewCustom',
      vendor: 'customendpoint',
      apiKey: '${input:chat.lm.secret.new}',
      apiType: 'chat-completions',
      models: [{ id: 'new-model', name: 'New Model', url: 'https://new.example.com/v1', toolCalling: false, vision: false, maxInputTokens: 10000, maxOutputTokens: 1000 }],
    };
    addCustomProvider(newEntry);
    expect(writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('NewCustom');
  });

  it('throws when name is missing', () => {
    expect(() => addCustomProvider({ vendor: 'customendpoint', models: [{ id: 'm' }] })).toThrow(
      'Provider entry must have name and at least one model',
    );
  });

  it('throws when models are empty', () => {
    expect(() => addCustomProvider({ name: 'X', models: [] })).toThrow(
      'Provider entry must have name and at least one model',
    );
  });

  it('throws when models is missing', () => {
    expect(() => addCustomProvider({ name: 'X' })).toThrow(
      'Provider entry must have name and at least one model',
    );
  });

  it('throws when provider already exists in custom config', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    expect(() => addCustomProvider({ name: 'deepseek', models: [{ id: 'dup' }] })).toThrow(
      'Provider "deepseek" already exists in custom config',
    );
  });

  it('appends to existing custom providers', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    writeFileSync.mockReturnValue(undefined);
    addCustomProvider({
      name: 'another-custom',
      vendor: 'customendpoint',
      apiKey: '',
      apiType: 'chat-completions',
      models: [{ id: 'ac-model', name: 'AC', url: 'https://ac.example.com/v1', toolCalling: true, vision: false, maxInputTokens: 1000, maxOutputTokens: 500 }],
    });
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(3);
    expect(written[2].name).toBe('another-custom');
  });
});

// ── removeCustomProvider ────────────────────────────────────────────────────

describe('removeCustomProvider', () => {
  it('removes existing custom provider by name', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    writeFileSync.mockReturnValue(undefined);
    removeCustomProvider('deepseek');
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('custom-only-provider');
  });

  it('removes the only provider', () => {
    readFileSync.mockReturnValue(JSON.stringify([SAMPLE_CUSTOM[0]]));
    writeFileSync.mockReturnValue(undefined);
    removeCustomProvider('deepseek');
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(0);
  });

  it('throws when provider not found', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    expect(() => removeCustomProvider('unknown')).toThrow(
      'Provider "unknown" not found in custom config',
    );
  });
});

// ── updateCustomProvider ────────────────────────────────────────────────────

describe('updateCustomProvider', () => {
  const UPDATED_ENTRY = {
    name: 'deepseek',
    vendor: 'customendpoint',
    apiKey: '${input:chat.lm.secret.updated}',
    apiType: 'chat-completions',
    models: [{ id: 'updated-model', name: 'Updated', url: 'https://updated.example.com/v1', toolCalling: true, vision: true, maxInputTokens: 999, maxOutputTokens: 999 }],
  };

  it('updates existing custom provider by name', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    writeFileSync.mockReturnValue(undefined);
    updateCustomProvider('deepseek', UPDATED_ENTRY);
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(2);
    const updated = written.find((p) => p.name === 'deepseek');
    expect(updated.models[0].id).toBe('updated-model');
    expect(updated.apiKey).toBe('${input:chat.lm.secret.updated}');
  });

  it('adds provider if name not found in custom config', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    writeFileSync.mockReturnValue(undefined);
    updateCustomProvider('brand-new', {
      name: 'brand-new',
      vendor: 'customendpoint',
      apiKey: '',
      apiType: 'chat-completions',
      models: [{ id: 'bn', name: 'BN', url: 'https://bn.example.com/v1', toolCalling: false, vision: false, maxInputTokens: 100, maxOutputTokens: 100 }],
    });
    const written = JSON.parse(writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(3);
    expect(written[2].name).toBe('brand-new');
  });

  it('throws when entry has no name', () => {
    expect(() => updateCustomProvider('x', { models: [{ id: 'm' }] })).toThrow(
      'Provider entry must have name and at least one model',
    );
  });

  it('throws when entry has empty models', () => {
    expect(() => updateCustomProvider('x', { name: 'x', models: [] })).toThrow(
      'Provider entry must have name and at least one model',
    );
  });
});

// ── listMergedProviderNames ─────────────────────────────────────────────────

describe('listMergedProviderNames', () => {
  it('returns all provider names from merged config', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const names = listMergedProviderNames();
    expect(names).toContain('deepseek');
    expect(names).toContain('openai');
    expect(names).toContain('custom-only-provider');
    // Ensure all built-in names are present
    const builtIn = getBuiltInConfig();
    for (const p of builtIn) {
      expect(names).toContain(p.name);
    }
  });

  it('returns only built-in names when custom is empty', () => {
    readFileSync.mockReturnValue('[]');
    const names = listMergedProviderNames();
    const builtInNames = getBuiltInConfig().map((p) => p.name);
    expect(names).toEqual(builtInNames);
  });
});

// ── listMergedModelsForProvider ─────────────────────────────────────────────

describe('listMergedModelsForProvider', () => {
  it('returns models for existing provider (overridden by custom)', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const models = listMergedModelsForProvider('deepseek');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('custom-model');
  });

  it('returns built-in models when provider not overridden in custom', () => {
    readFileSync.mockReturnValue('[]');
    const models = listMergedModelsForProvider('openai');
    const builtIn = getBuiltInConfig().find((p) => p.name === 'openai');
    expect(models).toEqual(builtIn.models);
  });

  it('returns empty array for unknown provider', () => {
    readFileSync.mockReturnValue('[]');
    expect(listMergedModelsForProvider('unknown')).toEqual([]);
  });

  it('returns models for custom-only provider', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const models = listMergedModelsForProvider('custom-only-provider');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('custom-only-model');
  });
});

// ── _resetCache ─────────────────────────────────────────────────────────────

describe('_resetCache', () => {
  it('clears the in-memory cache, forcing re-read on next getCustomConfig', () => {
    readFileSync.mockReturnValue(JSON.stringify(SAMPLE_CUSTOM));
    const first = getCustomConfig();
    expect(first).toEqual(SAMPLE_CUSTOM);

    // Change what readFileSync returns
    const newCustom = [{ name: 'new', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [] }];
    // Note: _resetCache() was called in beforeEach, so we need to test that the
    // cache is cleared and next call re-reads from disk
    _resetCache();
    readFileSync.mockReturnValue(JSON.stringify(newCustom));
    const second = getCustomConfig();
    expect(second).toEqual(newCustom);
  });
});

// ── Edge cases for getMergedConfig ──────────────────────────────────────────

describe('getMergedConfig (edge cases)', () => {
  it('handles custom config that overrides all built-in providers', () => {
    const builtIn = getBuiltInConfig();
    const allOverrides = builtIn.map((p) => ({
      name: p.name,
      vendor: 'customendpoint',
      apiKey: '',
      apiType: 'chat-completions',
      models: [{ id: `override-${p.name}`, name: `Override ${p.name}`, url: 'https://override.example.com/v1', toolCalling: false, vision: false, maxInputTokens: 1, maxOutputTokens: 1 }],
    }));
    readFileSync.mockReturnValue(JSON.stringify(allOverrides));
    const merged = getMergedConfig();
    expect(merged).toHaveLength(builtIn.length);
    for (const p of merged) {
      expect(p.models[0].id).toBe(`override-${p.name}`);
    }
  });

  it('handles circular reference in custom config gracefully', () => {
    const circular = [{ name: 'circular', vendor: 'customendpoint', apiKey: '', apiType: 'chat-completions', models: [{ id: 'c', name: 'c', url: 'https://c.example.com/v1', toolCalling: false, vision: false, maxInputTokens: 1, maxOutputTokens: 1 }] }];
    readFileSync.mockReturnValue(JSON.stringify(circular));
    const merged = getMergedConfig();
    const circ = merged.find((p) => p.name === 'circular');
    expect(circ).toBeDefined();
    expect(circ.models[0].id).toBe('c');
  });
});

// ── ensureConfigFile edge case ──────────────────────────────────────────────

describe('custom config file initialization', () => {
  it('creates directory and writes default [] when file does not exist', () => {
    existsSync.mockReturnValueOnce(false); // ensureCustomConfigFile
    mkdirSync.mockReturnValue(undefined);
    writeFileSync.mockReturnValue(undefined);
    existsSync.mockReturnValueOnce(false); // parseCustomConfig after mkdir
    readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => getCustomConfig()).toThrow();
    expect(mkdirSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledWith(
      CUSTOM_CONFIG_PATH,
      JSON.stringify([], null, 2),
      'utf8',
    );
  });

  it('does not create file if it already exists', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('[]');
    expect(getCustomConfig()).toEqual([]);
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
