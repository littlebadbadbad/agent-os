import { describe, it, expect } from 'vitest';
import { generateOverview } from '../json-overview';
import { analyzeJson } from '../json-analyze';
import { walkJson } from '../json-walk';
import type { JsonOverview } from '../json-overview';
import type { StrategyResult } from '../json-analyze';

import {
  generateWideObject,
  generateDeepNested,
  generateLargeStringField,
  generateLongArray,
  generateArrayOfObjects,
  generateMixedComplex,
  generateArrayOfPrimitives,
  generateArrayOfArrays,
  generateLargeFlatObject,
  generateSparseObject,
} from './test-generators';

// ── Overview snapshot helper ──────────────────────────────────────────────────

function summarizeOverview(o: JsonOverview): Record<string, unknown> {
  return {
    rootType: o.rootType,
    sizeLabel: o.sizeLabel,
    sizeBytes: o.sizeBytes,
    nodeCount: o.nodeCount,
    maxDepth: o.maxDepth,
    maxBreadth: o.maxBreadth,
    rootChildCount: o.rootChildCount,
    rootKeysShown: o.rootKeys.length,
    rootKeySample: o.rootKeys.slice(0, 3).map((k) => ({
      key: k.key,
      type: k.type,
      sizeBytes: k.sizeBytes,
      keyCount: k.keyCount,
      elementCount: k.elementCount,
      stringLength: k.stringLength,
      preview: k.preview.slice(0, 60),
    })),
    typeCounts: o.typeCounts,
    largeFieldCount: o.largeFields.length,
    largeFieldSamples: o.largeFields.slice(0, 3).map((f) => ({
      path: f.path,
      type: f.type,
      sizeBytes: f.sizeBytes,
    })),
    strategy: o.strategy,
    strategyHint: o.strategyHint,
  };
}

function summarizeStrategy(s: StrategyResult): Record<string, unknown> {
  return { name: s.name, hint: s.hint };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JSON Overview — 巨型 JSON 结构扫描方案', () => {

  // ── Scenario 1: Wide Object ──────────────────────────────────────────────

  describe('Scenario 1: 宽对象 (200 keys)', () => {
    const root = generateWideObject(200);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 browse-keys 策略', () => {
      expect(strategy.name).toBe('browse-keys');
    });

    it('overview 中 rootType 为 object，rootChildCount = 200', () => {
      expect(overview.rootType).toBe('object');
      expect(overview.rootChildCount).toBe(200);
    });

    it('rootKeys 只展示第一页 (30个)，供 AI 快速概览', () => {
      expect(overview.rootKeys.length).toBeLessThanOrEqual(30);
      expect(overview.rootKeys.length).toBeGreaterThan(0);
    });

    it('每个 rootKey 包含类型、大小、预览', () => {
      const first = overview.rootKeys[0];
      expect(first.key).toMatch(/^field_\d{4}$/);
      expect(first.type).toBe('object');
      expect(first.sizeBytes).toBeGreaterThan(0);
      expect(first.keyCount).toBeGreaterThan(0);
    });

    it('typeCounts 中 string 最多（字段名+标签文本）', () => {
      expect(overview.typeCounts.string).toBeGreaterThan(overview.typeCounts.object);
    });

    it('strategyHint 提示分页浏览', () => {
      expect(overview.strategyHint).toMatch(/page/i);
    });

    it('overview summary', () => {
      console.log('\n=== Wide Object Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 2: Deep Nested ──────────────────────────────────────────────

  describe('Scenario 2: 深层嵌套 (30 levels)', () => {
    const root = generateDeepNested(30);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 drill-down 策略', () => {
      expect(strategy.name).toBe('drill-down');
    });

    it('maxDepth ≥ 29', () => {
      expect(overview.maxDepth).toBeGreaterThanOrEqual(29);
    });

    it('strategyHint 包含深度信息和建议路径', () => {
      expect(overview.strategyHint).toMatch(/depth/i);
      expect(overview.strategyHint).toMatch(/deep/);
    });

    it('overview summary', () => {
      console.log('\n=== Deep Nested Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 3: Large String ─────────────────────────────────────────────

  describe('Scenario 3: 超大字符串字段 (100KB)', () => {
    const root = generateLargeStringField(100_000);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 chunk-string 策略', () => {
      expect(strategy.name).toBe('chunk-string');
    });

    it('largeFields 中包含那个大字符串', () => {
      const contentField = overview.largeFields.find((f) => f.path === 'content');
      expect(contentField).toBeDefined();
      expect(contentField!.type).toBe('string');
      expect(contentField!.stringLength).toBe(100_000);
    });

    it('sizeLabel 约 100KB', () => {
      expect(overview.sizeBytes).toBeGreaterThan(90_000);
    });

    it('strategyHint 告知用 var_read_path 分块读取', () => {
      expect(overview.strategyHint).toMatch(/chunk/i);
      expect(overview.strategyHint).toMatch(/var_read_path/);
    });

    it('overview summary', () => {
      console.log('\n=== Large String Field Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 4: Long Array ───────────────────────────────────────────────

  describe('Scenario 4: 长数组 (5000 elements)', () => {
    const root = generateLongArray(5_000);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 inspect-schema 策略 (长对象数组)', () => {
      expect(strategy.name).toBe('inspect-schema');
    });

    it('rootType 为 array, rootChildCount = 5000', () => {
      expect(overview.rootType).toBe('array');
      expect(overview.rootChildCount).toBe(5_000);
    });

    it('rootKeys 显示前 30 个元素', () => {
      expect(overview.rootKeys.length).toBeLessThanOrEqual(30);
      expect(overview.rootKeys[0].key).toBe('[0]');
      expect(overview.rootKeys[0].type).toBe('object');
    });

    it('strategyHint 建议先检测 [0] 的 schema', () => {
      expect(overview.strategyHint).toMatch(/\[0\]/);
      expect(overview.strategyHint).toMatch(/5000/);
      expect(overview.strategyHint).toMatch(/page/i);
    });

    it('overview summary', () => {
      console.log('\n=== Long Array Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 5: Array of Objects (tabular) ───────────────────────────────

  describe('Scenario 5: 对象数组/表结构 (500 rows)', () => {
    const root = generateArrayOfObjects(500);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 inspect-schema 策略', () => {
      expect(strategy.name).toBe('inspect-schema');
    });

    it('strategyHint 建议先检测 [0] 的结构', () => {
      expect(overview.strategyHint).toMatch(/\[0\]/);
    });

    it('strategyHint 包含首元素的 keys', () => {
      expect(overview.strategyHint).toMatch(/id/);
      expect(overview.strategyHint).toMatch(/name/);
    });

    it('rootKeys[0] 展示第一个对象的结构预览', () => {
      expect(overview.rootKeys[0].key).toBe('[0]');
      expect(overview.rootKeys[0].type).toBe('object');
      expect(overview.rootKeys[0].preview).toMatch(/User 0/);
    });

    it('overview summary', () => {
      console.log('\n=== Array of Objects Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 6: Mixed Complex ────────────────────────────────────────────

  describe('Scenario 6: 混合复杂结构', () => {
    const root = generateMixedComplex();
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 mixed 策略 (多重特征)', () => {
      expect(strategy.name).toBe('mixed');
    });

    it('rootType 为 object，多个子字段类型各异', () => {
      expect(overview.rootType).toBe('object');
      const types = overview.rootKeys.map((k) => k.type);
      expect(types).toContain('object');
      expect(types).toContain('string');
      expect(types).toContain('array');
    });

    it('largeFields 包含大字符串和数组', () => {
      const types = overview.largeFields.map((f) => f.type);
      expect(types).toContain('string');
      expect(types).toContain('array');
    });

    it('strategyHint 列出 depth 和 large string 特征', () => {
      expect(overview.strategyHint).toMatch(/large string/);
      expect(overview.strategyHint).toMatch(/depth/);
    });

    it('overview summary', () => {
      console.log('\n=== Mixed Complex Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 7: Array of Primitives ──────────────────────────────────────

  describe('Scenario 7: 原始值数组 (10,000 numbers)', () => {
    const root = generateArrayOfPrimitives(10_000);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 paginate-array 策略', () => {
      expect(strategy.name).toBe('paginate-array');
    });

    it('rootType 为 array, 所有 rootKeys type = number', () => {
      expect(overview.rootType).toBe('array');
      expect(overview.rootChildCount).toBe(10_000);
      overview.rootKeys.forEach((k) => {
        expect(k.type).toBe('number');
      });
    });

    it('每个 rootKey 显示具体数值', () => {
      expect(overview.rootKeys[0].preview).toBe('0');
      expect(overview.rootKeys[1].preview).toBe('1.5');
    });

    it('overview summary', () => {
      console.log('\n=== Array of Primitives Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 8: Array of Arrays ──────────────────────────────────────────

  describe('Scenario 8: 嵌套数组 (100 × 50)', () => {
    const root = generateArrayOfArrays(100, 50);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('rootType 为 array，子元素也都是 array', () => {
      expect(overview.rootType).toBe('array');
      overview.rootKeys.forEach((k) => {
        expect(k.type).toBe('array');
        expect(k.elementCount).toBe(50);
      });
    });

    it('应为 paginate-array 策略 (array of arrays)', () => {
      expect(strategy.name).toBe('paginate-array');
    });

    it('overview summary', () => {
      console.log('\n=== Array of Arrays Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 9: Large Flat Object ────────────────────────────────────────

  describe('Scenario 9: 大扁平对象 (500 primitive keys)', () => {
    const root = generateLargeFlatObject(500);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 browse-keys 策略', () => {
      expect(strategy.name).toBe('browse-keys');
    });

    it('rootChildCount = 500, 但 maxDepth = 1', () => {
      expect(overview.rootChildCount).toBe(500);
      expect(overview.maxDepth).toBe(1);
    });

    it('rootKeys 展示所有 key 类型 (string/number/boolean)', () => {
      const types = new Set(overview.rootKeys.map((k) => k.type));
      expect(types.has('string')).toBe(true);
      expect(types.has('number')).toBe(true);
      expect(types.has('boolean')).toBe(true);
    });

    it('overview summary', () => {
      console.log('\n=== Large Flat Object Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario 10: Sparse Object ───────────────────────────────────────────

  describe('Scenario 10: 稀疏对象 (300 keys, 90% null)', () => {
    const root = generateSparseObject(300);
    const overview = generateOverview(root);
    const strategy = analyzeJson(root, walkJson(root));

    it('应识别为 browse-keys (many keys)', () => {
      expect(strategy.name).toBe('browse-keys');
    });

    it('typeCounts 中 null 占绝大多数', () => {
      expect(overview.typeCounts.null).toBeGreaterThan(overview.typeCounts.object);
    });

    it('rootKeys 显示大部分为 null', () => {
      const nullCount = overview.rootKeys.filter((k) => k.type === 'null').length;
      expect(nullCount).toBeGreaterThan(overview.rootKeys.length / 2);
    });

    it('overview summary', () => {
      console.log('\n=== Sparse Object Overview ===');
      console.log(JSON.stringify(summarizeOverview(overview), null, 2));
      console.log('Strategy:', JSON.stringify(summarizeStrategy(strategy), null, 2));
    });
  });

  // ── Scenario: Simple / Small JSON ────────────────────────────────────────

  describe('Baseline: 小型 JSON 应识别为 simple', () => {
    it('小型对象', () => {
      const root = { name: 'Alice', age: 30, city: 'NYC' };
      const overview = generateOverview(root);
      expect(overview.strategy).toBe('simple');
    });

    it('小型数组', () => {
      const root = [1, 2, 3, 4, 5];
      const overview = generateOverview(root);
      expect(overview.strategy).toBe('simple');
    });

    it('小型嵌套', () => {
      const root = { user: { name: 'Bob', scores: [90, 85, 92] } };
      const overview = generateOverview(root);
      expect(overview.strategy).toBe('simple');
    });
  });

  // ── Walk correctness checks ──────────────────────────────────────────────

  describe('Walk 统计准确性', () => {
    it('空对象: nodeCount=1, maxDepth=0', () => {
      const result = walkJson({});
      expect(result.nodeCount).toBe(1);
      expect(result.maxDepth).toBe(0);
      expect(result.typeCounts.object).toBe(1);
    });

    it('空数组: nodeCount=1, maxDepth=0', () => {
      const result = walkJson([]);
      expect(result.nodeCount).toBe(1);
      expect(result.maxDepth).toBe(0);
      expect(result.typeCounts.array).toBe(1);
    });

    it('嵌套结构: 正确计数', () => {
      const root = { a: { b: { c: 1 } }, d: [2, 3] };
      const result = walkJson(root);
      // nodes: root(object), a(object), b(object), c(number), d(array), 2(number), 3(number) = 7
      expect(result.nodeCount).toBe(7);
      expect(result.maxDepth).toBe(3);
      expect(result.typeCounts.object).toBe(3);
      expect(result.typeCounts.array).toBe(1);
      expect(result.typeCounts.number).toBe(3);
    });
  });
});
