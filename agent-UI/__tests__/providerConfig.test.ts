/**
 * Tests for providerConfig.ts — the validation pipeline shared by the
 * provider-config UI. JSON fixtures go through parseConfigJson so the whole
 * path (parse → validate) is covered without type assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_ROW,
  fmtCtx,
  fuzzyMatch,
  isRowComplete,
  parseConfigJson,
  providerIcon,
  toModelConfig,
  userFacingError,
  validateProviderConfig,
} from '../components/ProviderSelector/providerConfig';

function validate(json: string) {
  const parsed = parseConfigJson(json);
  if (!parsed.ok) return parsed;
  return validateProviderConfig(parsed.value);
}

const MODEL = '{"id":"gpt-x","name":"GPT X","url":"https://api.example.com/v1","toolCalling":true,"vision":false,"maxInputTokens":100000,"maxOutputTokens":4096}';
const ENTRY = `{"name":"example","apiKey":"sk-1","apiType":"chat-completions","models":[${MODEL}]}`;

describe('validateProviderConfig', () => {
  it('accepts a valid config', () => {
    const result = validate(`[${ENTRY}]`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].name).toBe('example');
      expect(result.value[0].models[0].id).toBe('gpt-x');
    }
  });

  it('rejects a non-array config', () => {
    expect(validate('{"name":"x"}')).toEqual({ ok: false, error: '配置必须是 JSON 数组格式' });
  });

  it('rejects an entry without a name', () => {
    const result = validate(`[{"models":[${MODEL}]}]`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('缺少 name');
  });

  it('rejects an entry with empty models', () => {
    const result = validate('[{"name":"x","apiType":"chat-completions","models":[]}]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('models 必须是非空数组');
  });

  it('rejects a model missing url (the exact mistake that hit the backend)', () => {
    const result = validate('[{"name":"x","apiType":"chat-completions","models":[{"id":"m"}]}]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('缺少 id 或 url');
  });

  it('rejects an unknown apiType', () => {
    const result = validate(`[{"name":"x","apiType":"graphql","models":[${MODEL}]}]`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('apiType');
  });

  it('rejects duplicate provider names', () => {
    const result = validate(`[${ENTRY},${ENTRY}]`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('重复定义');
  });

  it('defaults an empty model name to its id and keeps useProxy', () => {
    const result = validate(`[{"name":"example","apiType":"chat-completions","useProxy":true,"models":[{"id":"gpt-x","name":"","url":"https://a/v1"}]}]`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].models[0].name).toBe('gpt-x');
      expect(result.value[0].useProxy).toBe(true);
    }
  });

  it('rejects a non-object array item', () => {
    const result = validate('["just a string"]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('必须是 JSON 对象');
  });
});

describe('parseConfigJson', () => {
  it('parses valid JSON', () => {
    expect(parseConfigJson('[{"name":"a"}]').ok).toBe(true);
  });

  it('reports syntax errors', () => {
    const result = parseConfigJson('{oops');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^JSON 格式错误/);
  });
});

describe('toModelConfig / isRowComplete', () => {
  it('trims fields and defaults the display name to the id', () => {
    const config = toModelConfig({ ...DEFAULT_MODEL_ROW, id: '  a  ', url: ' https://a/v1 ' });
    expect(config.id).toBe('a');
    expect(config.name).toBe('a');
    expect(config.url).toBe('https://a/v1');
  });

  it('falls back to defaults for non-positive token counts', () => {
    const config = toModelConfig({ ...DEFAULT_MODEL_ROW, id: 'a', url: 'u', maxInputTokens: 0, maxOutputTokens: -5 });
    expect(config.maxInputTokens).toBe(DEFAULT_MODEL_ROW.maxInputTokens);
    expect(config.maxOutputTokens).toBe(DEFAULT_MODEL_ROW.maxOutputTokens);
  });

  it('a row is complete only with id and url', () => {
    expect(isRowComplete({ ...DEFAULT_MODEL_ROW, id: 'a', url: 'u' })).toBe(true);
    expect(isRowComplete({ ...DEFAULT_MODEL_ROW, id: 'a', url: '  ' })).toBe(false);
  });
});

describe('display helpers', () => {
  it('fmtCtx formats token budgets', () => {
    expect(fmtCtx(1_000_000)).toBe('1M');
    expect(fmtCtx(128_000)).toBe('128k');
    expect(fmtCtx(0)).toBe('');
  });

  it('providerIcon is stable and defined for any name', () => {
    expect(providerIcon('openai')).toBe(providerIcon('openai'));
    expect(providerIcon('')).toBeTruthy();
  });

  it('fuzzyMatch checks in-order characters', () => {
    expect(fuzzyMatch('gx', 'gpt-x')).toBe(true);
    expect(fuzzyMatch('z', 'gpt-x')).toBe(false);
  });

  it('userFacingError strips Electron IPC wrappers', () => {
    expect(
      userFacingError(new Error("Error invoking remote method 'app:model-config:addCustom': Error: boom")),
    ).toBe('boom');
    expect(userFacingError('plain')).toBe('plain');
  });
});
