import type { JsonValue, JsonObject, JsonArray } from './types';
import type { JsonType } from './json-expand';
import { jsonTypeOf } from './json-expand';
import { walkJson, type WalkResult, type LargeField, type TypeCounts } from './json-walk';
import { analyzeJson, type ExploreStrategy } from './json-analyze';

// ── Root key entry ────────────────────────────────────────────────────────────

export type RootKeyEntry = {
  readonly key: string;
  readonly type: JsonType;
  readonly sizeBytes: number;
  readonly keyCount: number;
  readonly elementCount: number;
  readonly stringLength: number;
  readonly preview: string;
};

// ── Overview result ───────────────────────────────────────────────────────────

export type JsonOverview = {
  /** Root value type. */
  readonly rootType: JsonType;
  /** Estimated serialized size in bytes. */
  readonly sizeBytes: number;
  /** Human-readable size. */
  readonly sizeLabel: string;
  /** Total distinct JSON nodes (objects, arrays, primitives). */
  readonly nodeCount: number;
  /** Maximum nesting depth (root = 0). */
  readonly maxDepth: number;
  /** Maximum number of children at any single level. */
  readonly maxBreadth: number;
  /** Count of each JSON type in the tree. */
  readonly typeCounts: TypeCounts;
  /** Number of root-level keys (object) or elements (array). */
  readonly rootChildCount: number;
  /** First page of root children with type metadata. */
  readonly rootKeys: readonly RootKeyEntry[];
  /** Top heaviest fields. */
  readonly largeFields: readonly LargeField[];
  /** Recommended exploration strategy. */
  readonly strategy: ExploreStrategy;
  /** Human-readable strategy description. */
  readonly strategyHint: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ROOT_KEY_PAGE_SIZE = 30;
const PREVIEW_LENGTH = 120;

// ── Size label ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Preview ───────────────────────────────────────────────────────────────────

function makePreview(value: JsonValue): string {
  const s = JSON.stringify(value);
  return s.length <= PREVIEW_LENGTH ? s : s.slice(0, PREVIEW_LENGTH) + '…';
}

// ── Root key builder ──────────────────────────────────────────────────────────

function buildRootKeyEntry(key: string, value: JsonValue): RootKeyEntry {
  const vt = jsonTypeOf(value);
  return {
    key,
    type: vt,
    sizeBytes: JSON.stringify(value).length,
    keyCount: vt === 'object' ? Object.keys(value as JsonObject).length : 0,
    elementCount: vt === 'array' ? (value as JsonArray).length : 0,
    stringLength: vt === 'string' ? (value as string).length : 0,
    preview: makePreview(value),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Generate a structural overview of any JSON value.
 *
 * The overview provides enough information for an AI (or human) to understand:
 * - What shape the JSON has at the top level
 * - Where the "heavy" parts are
 * - Which exploration strategy to use next
 *
 * For large JSONs the root keys are paginated (first ${ROOT_KEY_PAGE_SIZE} entries).
 */
export function generateOverview(root: JsonValue): JsonOverview {
  const walkResult: WalkResult = walkJson(root);
  const strategy = analyzeJson(root, walkResult);

  const rootType = jsonTypeOf(root);

  // Build root key entries (first page only).
  const rootKeys: RootKeyEntry[] = [];
  if (rootType === 'object') {
    const obj = root as JsonObject;
    const keys = Object.keys(obj);
    const end = Math.min(keys.length, ROOT_KEY_PAGE_SIZE);
    for (let i = 0; i < end; i++) {
      rootKeys.push(buildRootKeyEntry(keys[i], obj[keys[i]]));
    }
  } else if (rootType === 'array') {
    const arr = root as JsonArray;
    const end = Math.min(arr.length, ROOT_KEY_PAGE_SIZE);
    for (let i = 0; i < end; i++) {
      rootKeys.push(buildRootKeyEntry(`[${i}]`, arr[i]));
    }
  }

  const rootChildCount =
    rootType === 'object'
      ? Object.keys(root as JsonObject).length
      : rootType === 'array'
        ? (root as JsonArray).length
        : 0;

  return {
    rootType,
    sizeBytes: walkResult.sizeBytes,
    sizeLabel: formatBytes(walkResult.sizeBytes),
    nodeCount: walkResult.nodeCount,
    maxDepth: walkResult.maxDepth,
    maxBreadth: walkResult.maxBreadth,
    typeCounts: walkResult.typeCounts,
    rootChildCount,
    rootKeys,
    largeFields: walkResult.largeFields,
    strategy: strategy.name,
    strategyHint: strategy.hint,
  };
}
