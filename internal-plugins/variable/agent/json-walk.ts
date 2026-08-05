import type { JsonValue, JsonObject, JsonArray } from './types';
import { jsonTypeOf, type JsonType } from './json-expand';
import { pathToString, type PathSegment } from './json-path';

// ── Walk node ─────────────────────────────────────────────────────────────────

type WalkNode = {
  readonly value: JsonValue;
  readonly path: PathSegment[];
  readonly depth: number;
};

// ── Large field candidate ─────────────────────────────────────────────────────

export type LargeField = {
  readonly path: string;
  readonly type: JsonType;
  readonly sizeBytes: number;
  readonly keyCount: number;
  readonly elementCount: number;
  readonly stringLength: number;
  readonly preview: string;
};

// ── Walker result ─────────────────────────────────────────────────────────────

export type TypeCounts = Record<JsonType, number>;

export type WalkResult = {
  readonly sizeBytes: number;
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly maxBreadth: number;
  readonly typeCounts: TypeCounts;
  readonly largeFields: readonly LargeField[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TOP_LARGE_FIELDS = 10;
const PREVIEW_LENGTH = 120;
const EMPTY_TYPE_COUNTS: TypeCounts = {
  object: 0,
  array: 0,
  string: 0,
  number: 0,
  boolean: 0,
  null: 0,
};

// ── Size estimation ───────────────────────────────────────────────────────────

function estimateSize(value: JsonValue): number {
  const t = jsonTypeOf(value);
  switch (t) {
    case 'string':
      // JSON encoding: quotes + escaped content.  Approximate as len + 2.
      return (value as string).length + 2;
    case 'number':
      return String(value as number).length;
    case 'boolean':
      return (value as boolean) ? 4 : 5;
    case 'null':
      return 4;
    case 'object':
    case 'array': {
      // Recursively sum children plus structural overhead.
      const structuralOverhead = Array.isArray(value) ? 2 : 2; // [] or {}
      let sum = structuralOverhead;
      if (Array.isArray(value)) {
        const arr = value as JsonArray;
        const len = arr.length;
        for (let i = 0; i < len; i++) {
          sum += estimateSize(arr[i]);
          if (i < len - 1) sum += 1; // comma
        }
      } else {
        const obj = value as JsonObject;
        const keys = Object.keys(obj);
        const klen = keys.length;
        for (let i = 0; i < klen; i++) {
          const k = keys[i];
          sum += JSON.stringify(k).length + 1; // "key":
          sum += estimateSize(obj[k]);
          if (i < klen - 1) sum += 1; // comma
        }
      }
      return sum;
    }
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────

function makePreview(value: JsonValue): string {
  const s = JSON.stringify(value);
  return s.length <= PREVIEW_LENGTH ? s : s.slice(0, PREVIEW_LENGTH) + '…';
}

// ── Large field tracking (fixed-size top-N heap) ──────────────────────────────

function insertLargeField(list: LargeField[], candidate: LargeField, maxCount: number): void {
  if (list.length < maxCount) {
    list.push(candidate);
    list.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return;
  }
  if (candidate.sizeBytes <= list[list.length - 1].sizeBytes) return;
  list.pop();
  list.push(candidate);
  list.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

// ── Main walker ───────────────────────────────────────────────────────────────

/**
 * Iterative depth-first walk of a JSON tree, collecting structural statistics.
 *
 * - Counts nodes, tracks max depth & breadth, and counts types.
 * - Identifies the top-N largest fields (by estimated serialized size).
 * - Uses an explicit stack to avoid recursion overflow on deeply nested structures.
 * - Estimates sizes without calling JSON.stringify on the whole tree.
 */
export function walkJson(root: JsonValue): WalkResult {
  const typeCounts: TypeCounts = { ...EMPTY_TYPE_COUNTS };
  const largeFields: LargeField[] = [];

  let nodeCount = 0;
  let maxDepth = 0;
  let maxBreadth = 0;

  // Enqueue root's immediate children as siblings to start.
  const rootType = jsonTypeOf(root);
  typeCounts[rootType]++;
  nodeCount++;

  let rootChildren: Array<{ key: string; value: JsonValue }>;

  if (rootType === 'object') {
    const obj = root as JsonObject;
    const keys = Object.keys(obj);
    rootChildren = keys.map((k) => ({ key: k, value: obj[k] }));
  } else if (rootType === 'array') {
    const arr = root as JsonArray;
    rootChildren = arr.map((v, i) => ({ key: String(i), value: v }));
  } else {
    rootChildren = [];
  }

  // For each direct child of root, we track it as a large-field candidate.
  for (const { key, value } of rootChildren) {
    const sizeBytes = estimateSize(value);
    const childType = jsonTypeOf(value);
    const field: LargeField = {
      path: pathToString([key]),
      type: childType,
      sizeBytes,
      keyCount: childType === 'object' ? Object.keys(value as JsonObject).length : 0,
      elementCount: childType === 'array' ? (value as JsonArray).length : 0,
      stringLength: childType === 'string' ? (value as string).length : 0,
      preview: makePreview(value),
    };
    insertLargeField(largeFields, field, TOP_LARGE_FIELDS);
  }

  // Breadth-0 = root's direct children count.
  if (rootChildren.length > maxBreadth) {
    maxBreadth = rootChildren.length;
  }

  // Stack for DFS: push children with depth=1.
  const stack: WalkNode[] = rootChildren.map(({ key, value }) => ({
    value,
    path: [key],
    depth: 1,
  }));

  while (stack.length > 0) {
    const node = stack.pop()!;
    const { value, path: nodePath, depth } = node;

    const t = jsonTypeOf(value);
    typeCounts[t]++;
    nodeCount++;

    if (depth > maxDepth) maxDepth = depth;

    if (t === 'object' || t === 'array') {
      let children: Array<{ key: string; childValue: JsonValue }>;
      if (t === 'object') {
        const obj = value as JsonObject;
        const keys = Object.keys(obj);
        children = keys.map((k) => ({ key: k, childValue: obj[k] }));
      } else {
        const arr = value as JsonArray;
        children = arr.map((v, i) => ({ key: String(i), childValue: v }));
      }

      if (children.length > maxBreadth) maxBreadth = children.length;

      // Push children in reverse so first child processes first (DFS).
      for (let i = children.length - 1; i >= 0; i--) {
        const { key, childValue } = children[i];
        const childPath = [...nodePath, key];
        stack.push({ value: childValue, path: childPath, depth: depth + 1 });
      }
    }
  }

  return {
    sizeBytes: estimateSize(root),
    nodeCount,
    maxDepth,
    maxBreadth,
    typeCounts,
    largeFields,
  };
}
