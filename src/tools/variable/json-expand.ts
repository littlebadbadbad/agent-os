import type { JsonValue, JsonObject, JsonArray } from './types';
import { getAtPath, pathToString, type PathSegment } from './json-path';

// ── JSON type helper ──────────────────────────────────────────────────────────

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export function jsonTypeOf(value: JsonValue): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as 'string' | 'number' | 'boolean' | 'object';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STRING_PREVIEW_CHARS = 80;
const MAX_PAGE_SIZE = 100;
const MAX_READ_LENGTH = 100_000;

// ── Expand ────────────────────────────────────────────────────────────────────

export type ChildInfo = {
  key: string;
  type: JsonType;
  /** object: number of own keys */
  keyCount?: number;
  /** array: element count */
  length?: number;
  /** string: character count + truncated preview */
  charCount?: number;
  preview?: string;
  /** number / boolean / null: the primitive value */
  value?: number | boolean | null;
};

export type ExpandOkResult =
  | { path: string; type: 'object' | 'array'; totalChildren: number; page: number; pageSize: number; totalPages: number; children: ChildInfo[] }
  | { path: string; type: 'string'; charCount: number; preview: string; hint: string }
  | { path: string; type: 'number' | 'boolean' | 'null'; value: number | boolean | null };

export type ExpandResult = ExpandOkResult | { error: string };

/**
 * Browse the JSON structure at `segments` within `root`.
 * For objects/arrays returns a paginated list of direct children with type metadata.
 * For leaf values returns type info directly.
 */
export function expandNode(
  root: JsonValue,
  segments: PathSegment[],
  page: number,
  pageSize: number,
): ExpandResult {
  const node = getAtPath(root, segments);
  if (node === undefined) {
    return { error: `Path "${pathToString(segments)}" not found.` };
  }

  const path = pathToString(segments);
  const type = jsonTypeOf(node);

  if (type === 'string') {
    const s = node as string;
    const preview = s.slice(0, STRING_PREVIEW_CHARS) + (s.length > STRING_PREVIEW_CHARS ? '…' : '');
    const hint = s.length > STRING_PREVIEW_CHARS
      ? `String is ${s.length} chars. Use var_read_path to paginate the full content.`
      : '';
    return { path, type: 'string', charCount: s.length, preview, hint };
  }

  if (type === 'number' || type === 'boolean' || type === 'null') {
    return { path, type, value: node as number | boolean | null };
  }

  // object or array — enumerate children
  const isArray = Array.isArray(node);
  const keys = isArray
    ? (node as JsonArray).map((_, i) => String(i))
    : Object.keys(node as JsonObject);

  const totalChildren = keys.length;
  const ps = Math.max(1, Math.min(pageSize, MAX_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(totalChildren / ps));
  const p = Math.max(1, Math.min(page, totalPages));
  const pageKeys = keys.slice((p - 1) * ps, p * ps);

  const children: ChildInfo[] = pageKeys.map((key) => {
    const child = isArray ? (node as JsonArray)[Number(key)] : (node as JsonObject)[key];
    const childType = jsonTypeOf(child);
    const info: ChildInfo = { key, type: childType };
    switch (childType) {
      case 'object':
        info.keyCount = Object.keys(child as JsonObject).length;
        break;
      case 'array':
        info.length = (child as JsonArray).length;
        break;
      case 'string': {
        const s = child as string;
        info.charCount = s.length;
        info.preview = s.slice(0, STRING_PREVIEW_CHARS) + (s.length > STRING_PREVIEW_CHARS ? '…' : '');
        break;
      }
      default:
        info.value = child as number | boolean | null;
    }
    return info;
  });

  return { path, type: type as 'object' | 'array', totalChildren, page: p, pageSize: ps, totalPages, children };
}

// ── Read path ─────────────────────────────────────────────────────────────────

export type ReadPathOkResult =
  | { path: string; type: 'number' | 'boolean' | 'null'; value: number | boolean | null }
  | { path: string; type: 'string'; value: string; offset: number; length: number; totalSize: number; hasMore: boolean; nextOffset?: number }
  | { path: string; type: 'object' | 'array'; keys: string[]; page: number; pageSize: number; totalKeys: number; totalPages: number };

export type ReadPathResult = ReadPathOkResult | { error: string };

/**
 * Read the value at `segments` within `root` with optional pagination.
 *
 * - Primitives (number, boolean, null) are returned as-is.
 * - Strings: `offset` is a 0-based character offset, `maxLength` caps returned chars.
 * - Objects/arrays: `offset` is a 1-based page number (0 also means page 1),
 *   `maxLength` is the page size. Returns the paginated key list for the caller
 *   to decide which keys to drill into next.
 */
export function readAtPath(
  root: JsonValue,
  segments: PathSegment[],
  offset: number,
  maxLength: number,
): ReadPathResult {
  const node = getAtPath(root, segments);
  if (node === undefined) {
    return { error: `Path "${pathToString(segments)}" not found.` };
  }

  const path = pathToString(segments);
  const type = jsonTypeOf(node);

  if (type === 'number' || type === 'boolean' || type === 'null') {
    return { path, type, value: node as number | boolean | null };
  }

  if (type === 'string') {
    const fullText = node as string;
    const totalSize = fullText.length;
    const ml = Math.max(1, Math.min(maxLength, MAX_READ_LENGTH));
    const slice = fullText.slice(offset, offset + ml);
    const remaining = Math.max(0, totalSize - (offset + ml));
    return {
      path,
      type: 'string',
      value: slice,
      offset,
      length: slice.length,
      totalSize,
      hasMore: remaining > 0,
      ...(remaining > 0 && { nextOffset: offset + ml }),
    };
  }

  // object or array — return paginated key list
  const isArray = Array.isArray(node);
  const keys = isArray
    ? (node as JsonArray).map((_, i) => String(i))
    : Object.keys(node as JsonObject);

  const totalKeys = keys.length;
  const ps = Math.max(1, Math.min(maxLength, MAX_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(totalKeys / ps));
  const p = Math.max(1, Math.min(offset <= 0 ? 1 : offset, totalPages));
  const pageKeys = keys.slice((p - 1) * ps, p * ps);

  return { path, type: type as 'object' | 'array', keys: pageKeys, page: p, pageSize: ps, totalKeys, totalPages };
}
