/**
 * providerConfig.ts — shared types, validation, and helpers for the
 * provider-config UI (ProviderSelector, EditConfigPane, AddProviderForm).
 *
 * The custom-provider JSON schema lives here so the editor, the form, and
 * the API boundary all validate against one definition.
 */

import type { ApiType, ProviderEntry, ProviderModelConfig } from '../../store/providerConfigStore';
import { API_TYPES } from '../../store/providerConfigStore';

export type { ApiType, ProviderEntry, ProviderModelConfig };
export { API_TYPES };

/** Any JSON value, used to traverse parsed config without casts. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** One model row in the add-provider form. */
export interface ModelRow {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export const DEFAULT_MODEL_ROW: ModelRow = {
  id: '',
  name: '',
  url: '',
  toolCalling: true,
  vision: false,
  maxInputTokens: 128000,
  maxOutputTokens: 8192,
};

// ── JSON field readers ────────────────────────────────────────────────────────

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function readString(obj: JsonObject, key: string, fallback: string): string {
  const value = obj[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function readNumber(obj: JsonObject, key: string, fallback: number): number {
  const value = obj[key];
  return typeof value === 'number' ? positiveInt(value, fallback) : fallback;
}

function readBoolean(obj: JsonObject, key: string, fallback: boolean): boolean {
  const value = obj[key];
  return typeof value === 'boolean' ? value : fallback;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  if (value === null || typeof value !== 'object' || isJsonArray(value)) return null;
  return value;
}

function asJsonObjectArray(value: JsonValue | undefined): JsonObject[] | null {
  if (value === undefined || !isJsonArray(value)) return null;
  const items: JsonObject[] = [];
  for (const item of value) {
    const obj = asJsonObject(item);
    if (obj === null) return null;
    items.push(obj);
  }
  return items;
}

// ── Model conversion ──────────────────────────────────────────────────────────

/** Build a persistable model config from a form row (trims, defaults empty name to id). */
export function toModelConfig(row: ModelRow): ProviderModelConfig {
  const id = row.id.trim();
  const name = row.name.trim();
  return {
    id,
    name: name === '' ? id : name,
    url: row.url.trim(),
    toolCalling: row.toolCalling,
    vision: row.vision,
    maxInputTokens: positiveInt(row.maxInputTokens, DEFAULT_MODEL_ROW.maxInputTokens),
    maxOutputTokens: positiveInt(row.maxOutputTokens, DEFAULT_MODEL_ROW.maxOutputTokens),
  };
}

/** A row counts once it has both id and url (after trimming). */
export function isRowComplete(row: ModelRow): boolean {
  return row.id.trim() !== '' && row.url.trim() !== '';
}

function parseModel(obj: JsonObject): ProviderModelConfig {
  const id = readString(obj, 'id', '');
  return {
    id,
    name: readString(obj, 'name', id),
    url: readString(obj, 'url', ''),
    toolCalling: readBoolean(obj, 'toolCalling', false),
    vision: readBoolean(obj, 'vision', false),
    maxInputTokens: readNumber(obj, 'maxInputTokens', DEFAULT_MODEL_ROW.maxInputTokens),
    maxOutputTokens: readNumber(obj, 'maxOutputTokens', DEFAULT_MODEL_ROW.maxOutputTokens),
  };
}

// ── Config validation ─────────────────────────────────────────────────────────

function isApiType(value: string): value is ApiType {
  return API_TYPES.some((t) => t === value);
}

/**
 * Validate one parsed JSON object as a provider entry, returning a clean
 * `ProviderEntry` or a human-readable (Chinese) error message.
 */
export function validateProviderEntry(input: JsonValue, index: number): ValidationResult<ProviderEntry> {
  const label = `第 ${index + 1} 个提供商`;
  const obj = asJsonObject(input);
  if (obj === null) return { ok: false, error: `${label}：必须是 JSON 对象` };

  const name = readString(obj, 'name', '');
  if (name === '') return { ok: false, error: `${label}：缺少 name` };

  const rawApiType = obj.apiType;
  if (typeof rawApiType !== 'string' || !isApiType(rawApiType)) {
    return { ok: false, error: `${label} "${name}"：apiType 必须是 ${API_TYPES.join(' / ')} 之一` };
  }

  const rawModels = asJsonObjectArray(obj.models);
  if (rawModels === null || rawModels.length === 0) {
    return { ok: false, error: `${label} "${name}"：models 必须是非空数组` };
  }
  const models = rawModels.map(parseModel);
  const incomplete = models.findIndex((m) => m.id === '' || m.url === '');
  if (incomplete !== -1) {
    return { ok: false, error: `${label} "${name}"：第 ${incomplete + 1} 个模型缺少 id 或 url` };
  }

  const useProxy = typeof obj.useProxy === 'boolean' ? { useProxy: obj.useProxy } : {};
  return {
    ok: true,
    value: { name, apiKey: readString(obj, 'apiKey', ''), apiType: rawApiType, models, ...useProxy },
  };
}

/**
 * Validate a parsed JSON value as the full custom-provider config array.
 * Rejects duplicates, which the backend merge would silently collapse.
 */
export function validateProviderConfig(value: JsonValue): ValidationResult<ProviderEntry[]> {
  if (!isJsonArray(value)) return { ok: false, error: '配置必须是 JSON 数组格式' };

  const config: ProviderEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const result = validateProviderEntry(item, index);
    if (!result.ok) return result;
    if (seen.has(result.value.name)) {
      return { ok: false, error: `提供商 "${result.value.name}" 重复定义` };
    }
    seen.add(result.value.name);
    config.push(result.value);
  }
  return { ok: true, value: config };
}

/** Parse user-entered JSON for the custom config editor. */
export function parseConfigJson(raw: string): ValidationResult<JsonValue> {
  try {
    const parsed: JsonValue = JSON.parse(raw);
    return { ok: true, value: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `JSON 格式错误: ${message}` };
  }
}

/** Strip Electron IPC noise so users see only the backend error message. */
export function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const match = /Error: (.*)$/.exec(message);
  return match === null ? message : match[1];
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format a context-window token count as "1M", "128k", etc. */
export function fmtCtx(n: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const ICONS = ['✦', '🔮', '☁️', '🧠', '🐋', '⚡', '🔌', '🌐', '⚙️', '📡'];

/** Stable icon per provider name (hash-based, so filtering never reassigns icons). */
export function providerIcon(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ICONS[hash % ICONS.length];
}

/** True when every char of query appears in-order within text. */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}
