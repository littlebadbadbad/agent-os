import type { JsonValue, JsonObject, JsonArray } from './types';
import { jsonTypeOf } from './json-expand';
import type { WalkResult } from './json-walk';

// ── Strategy type ─────────────────────────────────────────────────────────────

/**
 * Recommended exploration strategy for a JSON variable.
 *
 * - `simple`         — Small enough to read directly or with minimal browsing.
 * - `browse-keys`    — Wide object: paginate root keys, drill into interesting ones.
 * - `drill-down`     — Deeply nested: follow a specific deep path step by step.
 * - `chunk-string`   — Contains huge string field(s): read in character-offset chunks.
 * - `paginate-array` — Long array: browse elements page by page.
 * - `inspect-schema` — Array of objects (tabular): inspect element[0] structure first.
 * - `mixed`          — Multiple characteristics; overview + targeted drilling.
 */
export type ExploreStrategy =
  | 'simple'
  | 'browse-keys'
  | 'drill-down'
  | 'chunk-string'
  | 'paginate-array'
  | 'inspect-schema'
  | 'mixed';

// ── Strategy result ───────────────────────────────────────────────────────────

export type StrategyResult = {
  readonly name: ExploreStrategy;
  readonly hint: string;
};

// ── Thresholds ───────────────────────────────────────────────────────────────

const SIMPLE_MAX_SIZE = 4_000;
const SIMPLE_MAX_KEYS = 15;
const SIMPLE_MAX_DEPTH = 3;
const SIMPLE_MAX_ARRAY = 10;

const WIDE_KEY_THRESHOLD = 50;
const DEEP_THRESHOLD = 8;
const LARGE_STRING_THRESHOLD = 50_000;
const LONG_ARRAY_THRESHOLD = 200;
const ARRAY_OF_OBJECTS_MIN = 10;
const ARRAY_OF_OBJECTS_RATIO = 0.7; // 70% of array elements are objects

// ── Analysis ──────────────────────────────────────────────────────────────────

/**
 * Analyze a JSON value and its walk statistics to recommend the best exploration strategy.
 *
 * Strategies are determined by structural characteristics:
 *
 * | Strategy        | Trigger                                            |
 * |-----------------|----------------------------------------------------|
 * | simple          | Small overall (keys≤15, depth≤3, size≤4KB)         |
 * | browse-keys     | Wide object (≥50 root keys)                        |
 * | drill-down      | Deep nesting (maxDepth ≥ 8)                        |
 * | chunk-string    | Any string field ≥ 50KB                            |
 * | paginate-array  | Root is array with ≥ 200 elements                  |
 * | inspect-schema  | Root is array of ≥ 10 elements, ≥70% are objects   |
 * | mixed           | Multiple of the above triggers                     |
 *
 * The hint string provides a concise action recommendation for the AI.
 */
export function analyzeJson(root: JsonValue, stats: WalkResult): StrategyResult {
  const rootType = jsonTypeOf(root);

  // ── Gather characteristics ──────────────────────────────────────────────

  const isSimple =
    stats.sizeBytes <= SIMPLE_MAX_SIZE &&
    stats.maxDepth <= SIMPLE_MAX_DEPTH &&
    stats.nodeCount <= SIMPLE_MAX_KEYS * 2;

  const hasWideKeys =
    rootType === 'object' && Object.keys(root as JsonObject).length >= WIDE_KEY_THRESHOLD;

  const isDeep = stats.maxDepth >= DEEP_THRESHOLD;

  const hasLargeString =
    (rootType === 'string' && (root as string).length >= LARGE_STRING_THRESHOLD) ||
    stats.largeFields.some(
      (f) => f.type === 'string' && f.stringLength >= LARGE_STRING_THRESHOLD,
    );

  const isLongArray = rootType === 'array' && (root as JsonArray).length >= LONG_ARRAY_THRESHOLD;

  const isArrayOfObjects = ((): boolean => {
    if (rootType !== 'array') return false;
    const arr = root as JsonArray;
    if (arr.length < ARRAY_OF_OBJECTS_MIN) return false;
    let objectCount = 0;
    for (const el of arr) {
      if (jsonTypeOf(el) === 'object') objectCount++;
    }
    return objectCount / arr.length >= ARRAY_OF_OBJECTS_RATIO;
  })();

  const isArrayOfArrays = ((): boolean => {
    if (rootType !== 'array') return false;
    const arr = root as JsonArray;
    if (arr.length < ARRAY_OF_OBJECTS_MIN) return false;
    let arrayCount = 0;
    for (const el of arr) {
      if (jsonTypeOf(el) === 'array') arrayCount++;
    }
    return arrayCount / arr.length >= ARRAY_OF_OBJECTS_RATIO;
  })();

  // ── Determine strategy ──────────────────────────────────────────────────

  const flags: string[] = [];
  if (hasWideKeys) flags.push('wide');
  if (isDeep) flags.push('deep');
  if (hasLargeString) flags.push('large-string');
  if (isLongArray) flags.push('long-array');
  if (isArrayOfObjects) flags.push('array-of-objects');
  if (isArrayOfArrays) flags.push('array-of-arrays');

  if (isSimple) {
    return {
      name: 'simple',
      hint: 'This variable is small. Use var_read_path to read it directly, or var_expand to browse its structure.',
    };
  }

  // Compatible pairs take priority over generic "mixed".
  if (isLongArray && isArrayOfObjects && flags.length === 2) {
    const arr = root as JsonArray;
    const sample = arr[0] !== undefined && jsonTypeOf(arr[0]) === 'object'
      ? Object.keys(arr[0] as JsonObject).join(', ')
      : '';
    return {
      name: 'inspect-schema',
      hint: `Array of ${arr.length} objects. Use var_expand("handle", "[0]") to inspect the first element's structure (keys: ${sample}). Then paginate with page, pageSize for remaining entries.`,
    };
  }

  if (flags.length >= 2) {
    return buildMixedHint(root, stats, flags);
  }

  if (isArrayOfObjects) {
    const arr = root as JsonArray;
    const sample = arr[0] !== undefined && jsonTypeOf(arr[0]) === 'object'
      ? Object.keys(arr[0] as JsonObject).join(', ')
      : '';
    return {
      name: 'inspect-schema',
      hint: `Array of ${arr.length} objects. Use var_expand("handle", "[0]") to inspect the first element's structure (keys: ${sample}). Then paginate with page/pageSize.`,
    };
  }

  if (isArrayOfArrays) {
    const arr = root as JsonArray;
    const first = arr[0];
    const innerLen = Array.isArray(first) ? (first as JsonArray).length : 0;
    return {
      name: 'paginate-array',
      hint: `Array of ${arr.length} sub-arrays (each ~${innerLen} elements). Use var_expand with page/pageSize to browse outer array, then var_expand("handle", "[0]") to inspect inner structure.`,
    };
  }

  if (isLongArray) {
    const arr = root as JsonArray;
    return {
      name: 'paginate-array',
      hint: `Long array with ${arr.length} elements. Use var_expand with page=1, pageSize=20 to browse entries, then drill into specific indices.`,
    };
  }

  if (hasLargeString) {
    if (rootType === 'string') {
      const len = (root as string).length;
      return {
        name: 'chunk-string',
        hint: `Value is a single large string (${len} chars). Use var_read_path("handle", "", offset=0, maxLength=8000) to read it in chunks.`,
      };
    }
    const large = stats.largeFields.find(
      (f) => f.type === 'string' && f.stringLength >= LARGE_STRING_THRESHOLD,
    )!;
    return {
      name: 'chunk-string',
      hint: `Contains a large string field at "${large.path}" (${large.stringLength} chars). Use var_read_path("handle", "${large.path}", offset=0, maxLength=8000) to read it in chunks.`,
    };
  }

  if (isDeep) {
    const deepestPath = findDeepestPathHint(root);
    return {
      name: 'drill-down',
      hint: `Deeply nested (max depth ${stats.maxDepth}). Try drilling down: ${deepestPath}. Use var_expand step by step.`,
    };
  }

  if (hasWideKeys) {
    const obj = root as JsonObject;
    return {
      name: 'browse-keys',
      hint: `Wide object with ${Object.keys(obj).length} keys. Use var_expand with page/pageSize to browse keys, then var_read_path or var_expand on specific paths.`,
    };
  }

  // Fallback — shouldn't normally reach here.
  return {
    name: 'simple',
    hint: 'Use var_expand to browse the structure.',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMixedHint(
  root: JsonValue,
  stats: WalkResult,
  flags: string[],
): StrategyResult {
  const parts: string[] = [];

  if (flags.includes('wide')) {
    const keyCount = jsonTypeOf(root) === 'object' ? Object.keys(root as JsonObject).length : 0;
    parts.push(`${keyCount} root keys`);
  }
  if (flags.includes('deep')) {
    parts.push(`depth ${stats.maxDepth}`);
  }
  if (flags.includes('large-string')) {
    const large = stats.largeFields.find((f) => f.type === 'string' && f.stringLength >= LARGE_STRING_THRESHOLD);
    if (large) parts.push(`large string at "${large.path}"`);
  }
  if (flags.includes('long-array')) {
    parts.push('long array');
  }
  if (flags.includes('array-of-objects')) {
    parts.push('array of objects');
  }
  if (flags.includes('array-of-arrays')) {
    parts.push('array of arrays');
  }

  return {
    name: 'mixed',
    hint: `Complex structure (${parts.join(', ')}). Start with var_expand to see root-level layout. ` +
      `Look at largeFields for the heaviest subtrees to drill into.`,
  };
}

/**
 * Find a representative deep path for the hint.
 * Does a simple BFS to find a deep leaf.
 */
function findDeepestPathHint(root: JsonValue): string {
  type BfsNode = { value: JsonValue; path: string; depth: number };

  const queue: BfsNode[] = [{ value: root, path: '', depth: 0 }];
  let deepest: BfsNode = queue[0];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.depth > deepest.depth) deepest = node;

    const t = jsonTypeOf(node.value);
    if (t === 'object') {
      const obj = node.value as JsonObject;
      for (const key of Object.keys(obj)) {
        queue.push({
          value: obj[key],
          path: node.path ? `${node.path}.${key}` : key,
          depth: node.depth + 1,
        });
      }
    } else if (t === 'array') {
      const arr = node.value as JsonArray;
      if (arr.length > 0) {
        queue.push({
          value: arr[0],
          path: node.path ? `${node.path}[0]` : '[0]',
          depth: node.depth + 1,
        });
      }
    }
  }

  return deepest.path || '(root)';
}
