import type { JsonValue, JsonObject, JsonArray } from '../types';

// ── 1. Wide object: 200+ keys at root level ───────────────────────────────────

export function generateWideObject(keyCount: number = 200): JsonObject {
  const obj: Record<string, JsonValue> = {};
  for (let i = 0; i < keyCount; i++) {
    const key = `field_${String(i).padStart(4, '0')}`;
    obj[key] = {
      id: i,
      name: `Item ${i}`,
      value: Math.random() * 1000,
      tags: [`tag_${i % 10}`, `category_${i % 5}`],
    };
  }
  return obj;
}

// ── 2. Deep nested: chain of objects 30 levels deep ───────────────────────────

export function generateDeepNested(depth: number = 30): JsonObject {
  const root: Record<string, JsonValue> = { leaf: 42 };
  root.deep = buildDeepChain(depth - 1);
  return root;
}

function buildDeepChain(remaining: number): JsonObject {
  if (remaining <= 0) return { value: 'bottom' };
  return { child: buildDeepChain(remaining - 1) };
}

// ── 3. Large string field: a few normal fields + one 100KB string ─────────────

export function generateLargeStringField(stringLength: number = 100_000): JsonObject {
  const largeText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(Math.ceil(stringLength / 36)).slice(0, stringLength);
  return {
    id: 1,
    name: 'document_with_large_content',
    createdAt: '2026-01-01T00:00:00Z',
    content: largeText,
    summary: 'A short summary',
    metadata: { author: 'test', version: 2 },
  };
}

// ── 4. Long array: 5000 elements ──────────────────────────────────────────────

export function generateLongArray(elementCount: number = 5_000): JsonArray {
  const arr: JsonArray = [];
  for (let i = 0; i < elementCount; i++) {
    arr.push({
      index: i,
      value: `element_${i}`,
      score: Math.random(),
      active: i % 3 === 0,
    });
  }
  return arr;
}

// ── 5. Array of objects (tabular): 500 similar objects ────────────────────────

export function generateArrayOfObjects(elementCount: number = 500): JsonArray {
  const arr: JsonArray = [];
  for (let i = 0; i < elementCount; i++) {
    arr.push({
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      age: 20 + (i % 40),
      isActive: i % 5 !== 0,
      tags: [`tag_a${i % 3}`, `tag_b${i % 5}`],
      metadata: {
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-15T12:00:00Z',
        loginCount: i * 10,
      },
    });
  }
  return arr;
}

// ── 6. Mixed complex: deep + wide + large strings + arrays ────────────────────

export function generateMixedComplex(): JsonObject {
  const deep = buildDeepChain(10);
  const largeText = 'X'.repeat(80_000);
  const wide: Record<string, JsonValue> = {};
  for (let i = 0; i < 80; i++) {
    wide[`item_${String(i).padStart(3, '0')}`] = { id: i, data: `value_${i}` };
  }

  return {
    metadata: { version: '1.0', generatedAt: '2026-07-30T00:00:00Z' },
    deepSection: deep,
    wideSection: wide,
    largeContent: largeText,
    records: generateArrayOfObjects(100),
    stats: {
      total: 10000,
      distribution: { a: 3000, b: 4000, c: 3000 },
    },
  };
}

// ── 7. Array of primitives: 10,000 numbers ────────────────────────────────────

export function generateArrayOfPrimitives(count: number = 10_000): JsonArray {
  return Array.from({ length: count }, (_, i) => i * 1.5);
}

// ── 8. Array of arrays (nested arrays): 100 sub-arrays of 50 elements each ────

export function generateArrayOfArrays(
  outerCount: number = 100,
  innerCount: number = 50,
): JsonArray {
  return Array.from({ length: outerCount }, (_, i) =>
    Array.from({ length: innerCount }, (_, j) => ({ row: i, col: j, value: i * j })),
  );
}

// ── 9. Large flat object: 500 keys, all primitive values ──────────────────────

export function generateLargeFlatObject(keyCount: number = 500): JsonObject {
  const obj: Record<string, JsonValue> = {};
  for (let i = 0; i < keyCount; i++) {
    obj[`key_${String(i).padStart(5, '0')}`] = i % 3 === 0 ? `string_${i}` : i % 3 === 1 ? i : i % 7 === 0;
  }
  return obj;
}

// ── 10. Sparse object: many keys, most null ───────────────────────────────────

export function generateSparseObject(keyCount: number = 300): JsonObject {
  const obj: Record<string, JsonValue> = {};
  for (let i = 0; i < keyCount; i++) {
    obj[`prop_${String(i).padStart(4, '0')}`] = i % 10 === 0 ? { data: i } : null;
  }
  return obj;
}
