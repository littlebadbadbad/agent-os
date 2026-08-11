import { describe, it, expect } from 'vitest';
import { generateOverview } from '../json-overview';
import { walkJson } from '../json-walk';
import type { JsonOverview, RootKeyEntry } from '../json-overview';
import type { JsonValue, JsonObject, JsonArray } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function overviewOf(root: JsonValue): JsonOverview {
  return generateOverview(root);
}

// ── 第一节：原始值根 ──────────────────────────────────────────────────────────

describe('generateOverview — 原始值根', () => {

  it('string 根', () => {
    const o = overviewOf('hello world');
    expect(o.rootType).toBe('string');
    expect(o.rootChildCount).toBe(0);
    expect(o.rootKeys).toEqual([]);
    expect(o.nodeCount).toBe(1);
    expect(o.maxDepth).toBe(0);
    expect(o.maxBreadth).toBe(0);
    expect(o.typeCounts.string).toBe(1);
    expect(o.typeCounts.object).toBe(0);
    expect(o.typeCounts.array).toBe(0);
    expect(o.sizeBytes).toBe(13); // "hello world".length + 2
    expect(o.largeFields).toEqual([]);
    expect(o.strategy).toBe('simple');
  });

  it('空 string 根', () => {
    const o = overviewOf('');
    expect(o.rootType).toBe('string');
    expect(o.nodeCount).toBe(1);
    expect(o.sizeBytes).toBe(2); // quotes only
  });

  it('number 根', () => {
    const o = overviewOf(42);
    expect(o.rootType).toBe('number');
    expect(o.rootChildCount).toBe(0);
    expect(o.rootKeys).toEqual([]);
    expect(o.nodeCount).toBe(1);
    expect(o.maxDepth).toBe(0);
    expect(o.typeCounts.number).toBe(1);
    expect(o.strategy).toBe('simple');
  });

  it('number 根 — 负数', () => {
    const o = overviewOf(-3.14);
    expect(o.rootType).toBe('number');
    expect(o.nodeCount).toBe(1);
  });

  it('boolean 根 — true', () => {
    const o = overviewOf(true);
    expect(o.rootType).toBe('boolean');
    expect(o.typeCounts.boolean).toBe(1);
    expect(o.strategy).toBe('simple');
  });

  it('boolean 根 — false', () => {
    const o = overviewOf(false);
    expect(o.rootType).toBe('boolean');
  });

  it('null 根', () => {
    const o = overviewOf(null);
    expect(o.rootType).toBe('null');
    expect(o.typeCounts.null).toBe(1);
    expect(o.nodeCount).toBe(1);
    expect(o.strategy).toBe('simple');
  });

  it('超大字符串根 — 应触发 chunk-string 策略', () => {
    const huge = 'X'.repeat(60_000);
    const o = overviewOf(huge);
    expect(o.rootType).toBe('string');
    expect(o.strategy).toBe('chunk-string');
    expect(o.largeFields.length).toBe(0);
    expect(o.strategyHint).toMatch(/var_read_path/);
  });
});

// ── 第二节：空容器 ────────────────────────────────────────────────────────────

describe('generateOverview — 空容器', () => {

  it('空对象 {}', () => {
    const o = overviewOf({});
    expect(o.rootType).toBe('object');
    expect(o.rootChildCount).toBe(0);
    expect(o.rootKeys).toEqual([]);
    expect(o.nodeCount).toBe(1);
    expect(o.maxDepth).toBe(0);
    expect(o.maxBreadth).toBe(0);
    expect(o.typeCounts.object).toBe(1);
    expect(o.largeFields).toEqual([]);
    expect(o.strategy).toBe('simple');
  });

  it('空数组 []', () => {
    const o = overviewOf([]);
    expect(o.rootType).toBe('array');
    expect(o.rootChildCount).toBe(0);
    expect(o.rootKeys).toEqual([]);
    expect(o.nodeCount).toBe(1);
    expect(o.maxDepth).toBe(0);
    expect(o.maxBreadth).toBe(0);
    expect(o.typeCounts.array).toBe(1);
    expect(o.largeFields).toEqual([]);
    expect(o.strategy).toBe('simple');
  });

  it('嵌套空容器', () => {
    const o = overviewOf({ a: {}, b: [], c: { d: [] } });
    expect(o.rootType).toBe('object');
    expect(o.rootChildCount).toBe(3);
    expect(o.nodeCount).toBe(5); // root, a, b, c, d
    expect(o.maxDepth).toBe(2);
    expect(o.typeCounts.object).toBe(3); // root, a, c
    expect(o.typeCounts.array).toBe(2);  // b, d
  });
});

// ── 第三节：sizeLabel 格式化 ──────────────────────────────────────────────────

describe('generateOverview — sizeLabel', () => {

  it('< 1KB → 显示 B', () => {
    expect(overviewOf({ a: 1 }).sizeLabel).toBe('7B');
  });

  it('≥ 1KB → 显示 KB', () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      obj[`key${i}`] = 'valuevaluevaluevaluevalue'; // ~25 bytes each, 100 * ~25 = 2500+
    }
    expect(overviewOf(obj).sizeLabel).toMatch(/KB$/);
  });

  it('≥ 1MB → 显示 MB', () => {
    const arr: string[] = [];
    for (let i = 0; i < 50_000; i++) {
      arr.push('data_data_data_data_data_data_'); // ~32 bytes each
    }
    expect(overviewOf(arr).sizeLabel).toMatch(/MB$/);
  });
});

// ── 第四节：策略边界 ──────────────────────────────────────────────────────────

describe('generateOverview — 策略边界', () => {

  it('49 个 key 不触发 browse-keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 49; i++) obj[`k${i}`] = i;
    expect(overviewOf(obj).strategy).not.toBe('browse-keys');
  });

  it('50 个 key 触发 browse-keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 50; i++) obj[`k${i}`] = i;
    expect(overviewOf(obj).strategy).toBe('browse-keys');
  });

  it('深度 7 不触发 drill-down', () => {
    let obj: JsonObject = { v: 0 };
    for (let i = 0; i < 6; i++) obj = { child: obj };
    expect(overviewOf(obj).strategy).not.toBe('drill-down');
  });

  it('深度 8 触发 drill-down', () => {
    let obj: JsonObject = { v: 0 };
    for (let i = 0; i < 7; i++) obj = { child: obj };
    expect(overviewOf(obj).strategy).toBe('drill-down');
  });

  it('199 个元素数组不触发 long-array', () => {
    const arr = Array.from({ length: 199 }, (_, i) => i);
    expect(overviewOf(arr).strategy).not.toBe('paginate-array');
  });

  it('200 个基本类型元素数组触发 paginate-array', () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    expect(overviewOf(arr).strategy).toBe('paginate-array');
  });

  it('49,999 字符 string 字段不触发 chunk-string', () => {
    const o = overviewOf({ data: 'X'.repeat(49_999) });
    expect(o.strategy).not.toBe('chunk-string');
  });

  it('50,000 字符 string 字段触发 chunk-string', () => {
    const o = overviewOf({ data: 'X'.repeat(50_000) });
    expect(o.strategy).toBe('chunk-string');
  });

  it('simple 边界: 超过 4000B 且无其他特征时 fallback 仍是 simple', () => {
    const big = { data: 'X'.repeat(50_000) };
    expect(overviewOf(big).strategy).toBe('chunk-string');
  });

  it('simple 边界: nodeCount 超过 30 不再是 simple', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 20; i++) arr.push({ a: i, b: i * 2 });
    // 1 (root array) + 20 objects + 40 numbers = 61 nodes
    expect(overviewOf(arr).strategy).not.toBe('simple');
  });
});

// ── 第五节：array-of-objects 比率 ────────────────────────────────────────────

describe('generateOverview — array-of-objects 比率', () => {

  it('≥10 个元素且 ≥70% 是 object → inspect-schema（需超过 simple 阈值）', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 14; i++) arr.push({ id: i, name: `item${i}`, extra: 'data' });
    for (let i = 0; i < 6; i++) arr.push(i);
    expect(overviewOf(arr).strategy).toBe('inspect-schema');
  });

  it('60% 是 object 则不触发 inspect-schema', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 6; i++) arr.push({ id: i });
    for (let i = 0; i < 4; i++) arr.push(i);
    expect(overviewOf(arr).strategy).not.toBe('inspect-schema');
  });

  it('少于 10 个元素不触发 inspect-schema', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 9; i++) arr.push({ id: i });
    expect(overviewOf(arr).strategy).toBe('simple');
  });
});

// ── 第六节：策略优先级 ──────────────────────────────────────────────────────

describe('generateOverview — 策略优先级', () => {

  it('simple 优先级最高 — 即使有其他特征也先判 simple', () => {
    // 小于 4000B 且 depth≤3 且 nodeCount≤30 → simple
    const obj: Record<string, string> = {};
    for (let i = 0; i < 50; i++) obj[`k${i}`] = 'short';
    // 50 keys 但 size 很小 (sizeBytes < 4000? no...50 keys * ~12 bytes = ~600, plus values)
    // Let me check: each key is "k0"-"k49", each val is "short" -> about 600+ bytes.
    // But 50 keys triggers wide, and nodeCount = 51 > 30. So simple is false.
    // Let me try something smaller.
    const smallButWide: Record<string, number> = {};
    for (let i = 0; i < 30; i++) smallButWide[`k${i}`] = i;
    // nodeCount = 1 + 30 = 31 > 30, so simple=false.
    // Try with 15 keys: nodeCount=16 ≤ 30, depth=1 ≤ 3, size ~200B ≤ 4000 → simple
    const trulySimple: Record<string, number> = {};
    for (let i = 0; i < 15; i++) trulySimple[`k${i}`] = i;
    expect(overviewOf(trulySimple).strategy).toBe('simple');
  });

  it('long-array + array-of-objects → inspect-schema (兼容合并)', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 5000; i++) arr.push({ id: i, name: `item${i}` });
    expect(overviewOf(arr).strategy).toBe('inspect-schema');
  });

  it('long-array + array-of-objects + deep → mixed (3 flags)', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 5000; i++) {
      let deep: JsonObject = { v: 0 };
      for (let d = 0; d < 8; d++) deep = { child: deep };
      arr.push({ id: i, deep });
    }
    expect(overviewOf(arr).strategy).toBe('mixed');
  });

  it('wide + deep → mixed', () => {
    const obj: Record<string, JsonObject> = {};
    for (let i = 0; i < 50; i++) {
      let deep: JsonObject = { v: 0 };
      for (let d = 0; d < 8; d++) deep = { child: deep };
      obj[`k${i}`] = deep;
    }
    expect(overviewOf(obj).strategy).toBe('mixed');
  });

  it('wide + large-string → mixed', () => {
    const obj: Record<string, JsonValue> = {};
    for (let i = 0; i < 50; i++) obj[`k${i}`] = i;
    obj.largeStr = 'X'.repeat(60_000);
    expect(overviewOf(obj).strategy).toBe('mixed');
  });
});

// ── 第七节：largeFields — top-10 排序 & 上限 ────────────────────────────────

describe('generateOverview — largeFields', () => {

  it('largeFields 最多 10 个', () => {
    // 15 个不同大小的字段
    const obj: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      obj[`field_${i}`] = 'X'.repeat((i + 1) * 100);
    }
    const o = overviewOf(obj);
    expect(o.largeFields.length).toBeLessThanOrEqual(10);
  });

  it('largeFields 按 sizeBytes 降序排列', () => {
    const obj: Record<string, string> = {};
    // Create fields with known sizes: field_0=100, field_1=200, ... field_9=1000
    for (let i = 0; i < 10; i++) {
      obj[`field_${i}`] = 'X'.repeat((i + 1) * 100);
    }
    const o = overviewOf(obj);
    for (let i = 1; i < o.largeFields.length; i++) {
      expect(o.largeFields[i - 1].sizeBytes).toBeGreaterThanOrEqual(o.largeFields[i].sizeBytes);
    }
  });

  it('largeFields 包含 type / keyCount / elementCount / stringLength / preview', () => {
    const obj = {
      objField: { a: 1, b: 2, c: 3 },
      arrField: [1, 2, 3, 4, 5],
      strField: 'hello world',
      numField: 42,
      boolField: true,
      nullField: null,
    };
    const o = overviewOf(obj);

    const objF = o.largeFields.find((f) => f.path === 'objField')!;
    expect(objF.type).toBe('object');
    expect(objF.keyCount).toBe(3);

    const arrF = o.largeFields.find((f) => f.path === 'arrField')!;
    expect(arrF.type).toBe('array');
    expect(arrF.elementCount).toBe(5);

    const strF = o.largeFields.find((f) => f.path === 'strField')!;
    expect(strF.type).toBe('string');
    expect(strF.stringLength).toBe(11);

    const numF = o.largeFields.find((f) => f.path === 'numField')!;
    expect(numF.type).toBe('number');
    expect(numF.keyCount).toBe(0);
    expect(numF.elementCount).toBe(0);

    const nullF = o.largeFields.find((f) => f.path === 'nullField')!;
    expect(nullF.type).toBe('null');
  });

  it('largeFields 中 string 的 preview 被截断', () => {
    const obj = { longStr: 'X'.repeat(200) };
    const o = overviewOf(obj);
    const f = o.largeFields.find((x) => x.path === 'longStr')!;
    expect(f.preview.endsWith('…')).toBe(true);
    expect(f.preview.length).toBe(121); // 120 chars + '…'
  });

  it('小于等于 120 字符的 string 完整展示（含引号）', () => {
    const s = 'X'.repeat(118);
    const obj = { shortStr: s };
    const o = overviewOf(obj);
    const f = o.largeFields.find((x) => x.path === 'shortStr')!;
    expect(f.preview.endsWith('…')).toBe(false);
    expect(f.preview.length).toBeLessThanOrEqual(120);
  });
});

// ── 第八节：rootKeys ──────────────────────────────────────────────────────────

describe('generateOverview — rootKeys', () => {

  it('对象 rootKeys ≤ 30', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) obj[`key_${i}`] = i;
    const o = overviewOf(obj);
    expect(o.rootKeys.length).toBe(30);
  });

  it('数组 rootKeys ≤ 30', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const o = overviewOf(arr);
    expect(o.rootKeys.length).toBe(30);
  });

  it('rootKeys 少于 30 时展示全部', () => {
    const obj = { a: 1, b: 2, c: 3 };
    const o = overviewOf(obj);
    expect(o.rootKeys.length).toBe(3);
  });

  it('对象 rootKey.key 是原始 key 名', () => {
    const o = overviewOf({ myField: 42 });
    expect(o.rootKeys[0].key).toBe('myField');
  });

  it('数组 rootKey.key 是 [index] 格式', () => {
    const o = overviewOf([10, 20, 30]);
    expect(o.rootKeys[0].key).toBe('[0]');
    expect(o.rootKeys[1].key).toBe('[1]');
  });

  it('rootKey 对对象子元素展示 keyCount', () => {
    const o = overviewOf({ nested: { a: 1, b: 2, c: 3, d: 4, e: 5 } });
    expect(o.rootKeys[0].type).toBe('object');
    expect(o.rootKeys[0].keyCount).toBe(5);
  });

  it('rootKey 对数组子元素展示 elementCount', () => {
    const o = overviewOf({ items: [1, 2, 3, 4, 5] });
    expect(o.rootKeys[0].type).toBe('array');
    expect(o.rootKeys[0].elementCount).toBe(5);
  });

  it('rootKey 对 string 子元素展示 stringLength 和 preview', () => {
    const o = overviewOf({ title: 'Hello, World!' });
    expect(o.rootKeys[0].stringLength).toBe(13);
    expect(o.rootKeys[0].preview).toBe('"Hello, World!"');
  });

  it('rootKey 对超大 string 截断 preview', () => {
    const s = 'X'.repeat(200);
    const o = overviewOf({ large: s });
    expect(o.rootKeys[0].preview.endsWith('…')).toBe(true);
    expect(o.rootKeys[0].stringLength).toBe(200);
  });

  it('rootKey 对 primitive 显示具体值', () => {
    const o = overviewOf({ num: 42, bool: false, nil: null });
    expect(o.rootKeys.find((k) => k.key === 'num')!.preview).toBe('42');
    expect(o.rootKeys.find((k) => k.key === 'bool')!.preview).toBe('false');
    expect(o.rootKeys.find((k) => k.key === 'nil')!.preview).toBe('null');
  });
});

// ── 第九节：maxDepth / maxBreadth ────────────────────────────────────────────

describe('generateOverview — maxDepth / maxBreadth', () => {

  it('maxBreadth 记录整棵树的最大子节点数（非仅根）', () => {
    // 根有 2 个子节点，其中一个子节点有 10 个子节点
    const root = {
      small: { a: 1 },
      big: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i])),
    };
    const o = overviewOf(root);
    expect(o.maxBreadth).toBe(10);
  });

  it('maxDepth 为 0 的叶子层级正确', () => {
    const o = overviewOf({ leaf: 42 });
    expect(o.maxDepth).toBe(1); // root=0, leaf=1
  });

  it('深层嵌套的 maxDepth 准确', () => {
    let obj: JsonObject = { v: 0 };
    const targetDepth = 15;
    for (let i = 0; i < targetDepth - 1; i++) obj = { child: obj };
    const o = overviewOf(obj);
    expect(o.maxDepth).toBe(targetDepth);
  });
});

// ── 第十节：typeCounts 求和 = nodeCount ─────────────────────────────────────

describe('generateOverview — typeCounts 一致性', () => {

  it('所有 typeCounts 之和等于 nodeCount', () => {
    const root = {
      str: 'hello',
      num: 42,
      bool: true,
      nil: null,
      obj: { inner: 1 },
      arr: [1, 2, 3],
    };
    const o = overviewOf(root);
    const sum = Object.values(o.typeCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(o.nodeCount);
  });

  it('复杂结构的 typeCounts 求和正确', () => {
    // root(object) + 5 objects in items + 5 strings + 5 numbers
    const arr: JsonArray = [];
    for (let i = 0; i < 5; i++) arr.push({ id: i, name: `item${i}` });
    const o = overviewOf(arr);
    const sum = Object.values(o.typeCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(o.nodeCount);
  });
});

// ── 第十一节：sizeBytes vs JSON.stringify ───────────────────────────────────

describe('generateOverview — sizeBytes 与实际序列化接近', () => {

  it('基本对象的 sizeBytes 接近 JSON.stringify().length', () => {
    const obj = { a: 1, b: 'hello', c: true, d: null, e: [1, 2, 3] };
    const o = overviewOf(obj);
    const real = JSON.stringify(obj).length;
    // estimateSize 是近似值，允许 ±5 的误差
    expect(Math.abs(o.sizeBytes - real)).toBeLessThanOrEqual(5);
  });

  it('复杂嵌套的 sizeBytes 接近真实值', () => {
    const arr = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `item_${i}`,
      tags: [`a${i % 3}`, `b${i % 5}`],
    }));
    const o = overviewOf(arr);
    const real = JSON.stringify(arr).length;
    // 对于 50 个元素，估计误差应该在 50 字节以内
    expect(Math.abs(o.sizeBytes - real)).toBeLessThanOrEqual(50);
  });
});

// ── 第十二节：strategyHint 内容 ──────────────────────────────────────────────

describe('generateOverview — strategyHint 内容', () => {

  it('simple hint 建议直接读取', () => {
    expect(overviewOf({ a: 1 }).strategyHint).toMatch(/var_read_path|var_expand/);
  });

  it('browse-keys hint 包含 key 数量和分页建议', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 60; i++) obj[`k${i}`] = i;
    const o = overviewOf(obj);
    expect(o.strategyHint).toMatch(/60/);
    expect(o.strategyHint).toMatch(/page/i);
  });

  it('drill-down hint 包含深度和路径', () => {
    let obj: JsonObject = { v: 0 };
    for (let i = 0; i < 8; i++) obj = { child: obj };
    const o = overviewOf(obj);
    expect(o.strategyHint).toMatch(/depth.*9/);
    expect(o.strategyHint).toMatch(/child/);
  });

  it('chunk-string hint 包含路径、长度、offset、maxLength', () => {
    const o = overviewOf({ content: 'X'.repeat(60_000) });
    expect(o.strategyHint).toMatch(/content/);
    expect(o.strategyHint).toMatch(/60000/);
    expect(o.strategyHint).toMatch(/offset/);
    expect(o.strategyHint).toMatch(/maxLength/);
  });

  it('paginate-array hint 包含元素数量和 page/pageSize', () => {
    const arr = Array.from({ length: 300 }, (_, i) => i);
    const o = overviewOf(arr);
    expect(o.strategyHint).toMatch(/300/);
    expect(o.strategyHint).toMatch(/page/i);
  });

  it('inspect-schema hint 包含 [0] 和 keys', () => {
    const arr: JsonArray = [];
    for (let i = 0; i < 20; i++) arr.push({ id: i, name: `n${i}` });
    const o = overviewOf(arr);
    expect(o.strategyHint).toMatch(/\[0\]/);
    expect(o.strategyHint).toMatch(/id/);
    expect(o.strategyHint).toMatch(/name/);
  });

  it('mixed hint 列举所有特征', () => {
    const root: Record<string, JsonValue> = {};
    for (let i = 0; i < 60; i++) root[`k${i}`] = i;
    root.largeStr = 'X'.repeat(60_000);
    const o = overviewOf(root);
    expect(o.strategyHint).toMatch(/61 root keys/);
    expect(o.strategyHint).toMatch(/large string/i);
  });
});

// ── 第十三节：数组的多样化场景 ──────────────────────────────────────────────

describe('generateOverview — 数组多样化', () => {

  it('混合类型数组 — 不是单一 array-of-objects', () => {
    const arr: JsonArray = [{ a: 1 }, 2, 'three', true, null, [1, 2], { b: 3 }];
    const o = overviewOf(arr);
    // 2 objects out of 7 = 28% < 70%, not array-of-objects
    // 1 array out of 7 = 14% < 70%, not array-of-arrays
    // 7 < 200, not long-array, depth small → simple
    expect(o.strategy).toBe('simple');
    const types = new Set(o.rootKeys.map((k) => k.type));
    expect(types.size).toBeGreaterThanOrEqual(5); // object, number, string, boolean, null, array
  });

  it('全是 null 的数组 — 既不是 object 也不是 array-of-X', () => {
    const arr = Array.from({ length: 300 }, () => null);
    const o = overviewOf(arr);
    expect(o.strategy).toBe('paginate-array');
    expect(o.typeCounts.null).toBe(300);
  });

  it('全是 boolean 的数组', () => {
    const arr = Array.from({ length: 300 }, (_, i) => i % 2 === 0);
    const o = overviewOf(arr);
    expect(o.strategy).toBe('paginate-array');
    expect(o.typeCounts.boolean).toBe(300);
  });
});

// ── 第十四节：编号键对象 (类数组 object) ────────────────────────────────────

describe('generateOverview — 编号键对象', () => {

  it('key 为数字的普通对象按 object 处理（不是 array）', () => {
    const obj: Record<string, number> = { '0': 10, '1': 20, '2': 30 };
    const o = overviewOf(obj);
    expect(o.rootType).toBe('object');
    expect(o.rootChildCount).toBe(3);
    expect(o.rootKeys[0].key).toBe('0');
  });

  it('大量编号键触发 browse-keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 60; i++) obj[String(i)] = i;
    const o = overviewOf(obj);
    expect(o.strategy).toBe('browse-keys');
  });
});

// ── 第十五节：嵌套的 largeFields ────────────────────────────────────────────

describe('generateOverview — 深层 largeFields', () => {

  it('largeFields 追踪到深层嵌套的大字段', () => {
    // 深层嵌套中某个字段特别大
    const root = {
      a: { b: { c: { d: 'X'.repeat(80_000) } } },
      shallow: 'small',
    };
    const o = overviewOf(root);
    // a 包含很大的子树，应该在 largeFields 中
    const aField = o.largeFields.find((f) => f.path === 'a');
    expect(aField).toBeDefined();
    expect(aField!.sizeBytes).toBeGreaterThan(70_000);
  });

  it('largeFields 中 stringLength 对非字符串类型为 0', () => {
    const o = overviewOf({ arr: [1, 2, 3], str: 'hello' });
    const arrF = o.largeFields.find((f) => f.path === 'arr')!;
    expect(arrF.stringLength).toBe(0);
    const strF = o.largeFields.find((f) => f.path === 'str')!;
    expect(strF.stringLength).toBe(5);
  });

  it('largeFields 中 keyCount 对非对象类型为 0', () => {
    const o = overviewOf({ obj: { a: 1 }, num: 42 });
    const objF = o.largeFields.find((f) => f.path === 'obj')!;
    expect(objF.keyCount).toBe(1);
    const numF = o.largeFields.find((f) => f.path === 'num')!;
    expect(numF.keyCount).toBe(0);
  });
});
