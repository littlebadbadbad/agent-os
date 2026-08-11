import type { JsonValue, JsonObject, JsonArray } from './types';
import type { JsonType } from './json-expand';
import { jsonTypeOf } from './json-expand';
import { getAtPath, pathToString, type PathSegment } from './json-path';

// ── Constants ─────────────────────────────────────────────────────────────────

const STRING_PREVIEW_CHARS = 80;
const MAX_PAGE_SIZE = 100;

// ── Child info ────────────────────────────────────────────────────────────────

export type ChildInfo = {
  readonly key: string;
  readonly type: JsonType;
  readonly keyCount?: number;
  readonly elementCount?: number;
  readonly stringLength?: number;
  readonly preview?: string;
  readonly value?: number | boolean | null;
};

// ── Result types ──────────────────────────────────────────────────────────────

type ExploreChildren = {
  readonly path: string;
  readonly type: 'object' | 'array';
  readonly totalChildren: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly children: readonly ChildInfo[];
};

type ExploreString = {
  readonly path: string;
  readonly type: 'string';
  readonly value: string;
  readonly offset: number;
  readonly length: number;
  readonly totalSize: number;
  readonly hasMore: boolean;
  readonly nextOffset?: number;
};

type ExplorePrimitive = {
  readonly path: string;
  readonly type: 'number' | 'boolean' | 'null';
  readonly value: number | boolean | null;
};

export type ExploreResult = ExploreChildren | ExploreString | ExplorePrimitive | { readonly error: string };

// ── Child builder ─────────────────────────────────────────────────────────────

function buildChildInfo(value: JsonValue, key: string): ChildInfo {
  const type = jsonTypeOf(value);
  if (type === 'object') {
    return { key, type, keyCount: Object.keys(value as JsonObject).length };
  } else if (type === 'array') {
    return { key, type, elementCount: (value as JsonArray).length };
  } else if (type === 'string') {
    const s = value as string;
    return {
      key,
      type,
      stringLength: s.length,
      preview: s.length > STRING_PREVIEW_CHARS ? s.slice(0, STRING_PREVIEW_CHARS) + '…' : s,
    };
  } else {
    return { key, type, value: value as number | boolean | null };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Explore a JSON value at any path with a unified interface.
 *
 * - Object/Array at path → paginated children with type metadata
 * - String at path       → paginated content (offset-based)
 * - Primitive at path    → value returned directly
 *
 * `page` / `pageSize` control pagination for objects/arrays (children per page).
 * For strings, these map to character offset / chunk size.
 */
export function exploreNode(
  root: JsonValue,
  segments: PathSegment[],
  page: number,
  pageSize: number,
): ExploreResult {
  const node = getAtPath(root, segments);
  if (node === undefined) {
    return { error: `Path "${pathToString(segments)}" not found.` };
  }

  const path = pathToString(segments);
  const type = jsonTypeOf(node);

  // ── Primitives ──────────────────────────────────────────────────────────
  if (type === 'number' || type === 'boolean' || type === 'null') {
    return { path, type, value: node as number | boolean | null };
  }

  // ── String: paginated content ───────────────────────────────────────────
  if (type === 'string') {
    const s = node as string;
    const totalSize = s.length;
    const clampedPageSize = Math.max(1, Math.min(pageSize, 100_000));
    const offset = Math.max(0, (page - 1) * clampedPageSize);
    const slice = s.slice(offset, offset + clampedPageSize);
    const remaining = totalSize - (offset + slice.length);
    return {
      path,
      type: 'string',
      value: slice,
      offset,
      length: slice.length,
      totalSize,
      hasMore: remaining > 0,
      ...(remaining > 0 ? { nextOffset: offset + clampedPageSize } : {}),
    };
  }

  // ── Object / Array: paginated children ──────────────────────────────────
  const isArray = type === 'array';
  const keys = isArray
    ? (node as JsonArray).map((_, i) => String(i))
    : Object.keys(node as JsonObject);

  const totalChildren = keys.length;
  const clampedPageSize = Math.max(1, Math.min(pageSize, MAX_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(totalChildren / clampedPageSize));
  const clampedPage = Math.max(1, Math.min(page, totalPages));
  const pageKeys = keys.slice((clampedPage - 1) * clampedPageSize, clampedPage * clampedPageSize);

  const children: ChildInfo[] = pageKeys.map((key) => {
    const child = isArray
      ? (node as JsonArray)[Number(key)]
      : (node as JsonObject)[key];
    return buildChildInfo(child, key);
  });

  return { path, type, totalChildren, page: clampedPage, pageSize: clampedPageSize, totalPages, children };
}
