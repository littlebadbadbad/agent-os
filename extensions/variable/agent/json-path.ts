import type { JsonValue, JsonObject, JsonArray } from './types';

export type PathSegment = string | number;

/**
 * Parse a dot/bracket path string into an array of segments.
 *
 * Examples:
 *   ""          → []          (root)
 *   "a"         → ["a"]
 *   "a.b.c"     → ["a", "b", "c"]
 *   "a[0].b"    → ["a", 0, "b"]
 *   "[0]"       → [0]
 */
export function parsePath(path: string): PathSegment[] {
  if (!path || path === '.') return [];
  const segments: PathSegment[] = [];
  // Match plain keys (between dots/brackets) or bracketed integer indices.
  const re = /([^.[]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push(Number(match[2]));
    }
  }
  return segments;
}

/**
 * Reconstruct a canonical path string from segments.
 *
 * Examples:
 *   []               → ""
 *   ["a", "b", "c"]  → "a.b.c"
 *   ["a", 0, "b"]    → "a[0].b"
 */
export function pathToString(segments: PathSegment[]): string {
  if (segments.length === 0) return '';
  return segments.reduce<string>((acc, seg, i) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return i === 0 ? seg : `${acc}.${seg}`;
  }, '');
}

/**
 * Navigate to the value at `segments` within `root`.
 * Returns `undefined` if any step is out of bounds or type-mismatched.
 */
export function getAtPath(root: JsonValue, segments: PathSegment[]): JsonValue | undefined {
  let current: JsonValue = root;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const idx = typeof seg === 'number' ? seg : Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= (current as JsonArray).length) return undefined;
      current = (current as JsonArray)[idx];
    } else {
      const key = String(seg);
      if (!(key in (current as JsonObject))) return undefined;
      current = (current as JsonObject)[key];
    }
  }
  return current;
}
