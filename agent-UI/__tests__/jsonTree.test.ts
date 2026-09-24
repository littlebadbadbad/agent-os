/**
 * Tests for agent-UI/components/NetDebug/jsonTree.ts — the Chrome-style
 * foldable node model (buildJsonTree / flattenJsonTree / collectFoldableIds).
 */

import { describe, it, expect } from 'vitest';

import {
  buildJsonTree,
  flattenJsonTree,
  collectFoldableIds,
} from '../components/NetDebug/jsonTree';
import type { JsonTreeNode } from '../components/NetDebug/jsonTree';

const LONG = 'x'.repeat(200);

describe('buildJsonTree', () => {
  it('builds scalar leaves with inline tokens', () => {
    expect(buildJsonTree(42).kind).toBe('number');
    expect(buildJsonTree(true).kind).toBe('boolean');
    expect(buildJsonTree(null).kind).toBe('null');
    expect(buildJsonTree(undefined).kind).toBe('undefined');
    expect(buildJsonTree('hi').tokens).toEqual([['string', '"hi"']]);
  });

  it('labels object keys and array indices', () => {
    const root = buildJsonTree({ a: [1, 2] });
    expect(root.kind).toBe('object');
    const a = root.children?.[0];
    expect(a?.key).toBe('a');
    expect(a?.kind).toBe('array');
    expect(a?.children?.[0]).toMatchObject({ key: '0', inArray: true, kind: 'number' });
    expect(a?.children?.[1]).toMatchObject({ key: '1', inArray: true });
  });

  it('assigns hierarchical ids (index-based)', () => {
    const root = buildJsonTree({ a: { b: 1 } });
    expect(root.id).toBe('');
    expect(root.children?.[0].id).toBe('.0');
    expect(root.children?.[0].children?.[0].id).toBe('.0.0');
  });

  it('marks long strings foldable with a preview token', () => {
    const node = buildJsonTree(LONG, { longStringChars: 120 });
    expect(node.kind).toBe('string');
    expect(node.longString).toBe(true);
    expect(node.previewLength).toBe(120);
    expect(node.str).toBe(LONG);
    const token = node.tokens?.[0]?.[1] ?? '';
    expect(token.startsWith('"xxx')).toBe(true);
    expect(token.endsWith('"…')).toBe(true);
    // preview = 120 kept chars + 2 quotes + 1 ellipsis
    expect(token.length).toBe(120 + 3);
  });

  it('keeps short strings unfolded', () => {
    const node = buildJsonTree('short', { longStringChars: 120 });
    expect(node.longString).toBeUndefined();
    expect(node.previewLength).toBeUndefined();
  });

  it('detects circular references via the ancestor stack', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;
    obj.list = [obj];
    const root = buildJsonTree(obj);
    const self = root.children?.find((c) => c.key === 'self');
    expect(self?.kind).toBe('circular');
    const list = root.children?.find((c) => c.key === 'list');
    expect(list?.children?.[0]?.kind).toBe('circular');
  });

  it('allows shared (non-circular) subtrees to expand', () => {
    const shared = { v: 1 };
    const root = buildJsonTree({ a: shared, b: shared });
    expect(root.children?.[0].kind).toBe('object');
    expect(root.children?.[1].kind).toBe('object');
    expect(collectFoldableIds(root)).toEqual(['', '.0', '.1']);
  });

  it('collapses values beyond maxDepth into summaries', () => {
    const deep = buildJsonTree({ a: { b: { c: { d: 1 } } } }, { maxDepth: 2 });
    const a = deep.children?.[0];
    expect(a?.kind).toBe('object');
    const b = a?.children?.[0];
    expect(b?.kind).toBe('object');
    const c = b?.children?.[0];
    expect(c?.kind).toBe('circular'); // depth budget sentinel
    expect(c?.tokens?.[0]?.[1]).toContain('{');
  });

  it('renders empty containers without child rows', () => {
    expect(buildJsonTree({}).children).toEqual([]);
    expect(buildJsonTree([]).children).toEqual([]);
  });

  it('never throws on exotic values', () => {
    const fn = () => 1;
    const sym = Symbol('s');
    const root = buildJsonTree({
      fn,
      sym,
      big: 10n,
      date: new Date(0),
      err: new Error('boom'),
      nested: [() => 2, Symbol('t')],
    });
    const kinds = (root.children ?? []).map((c) => c.kind);
    expect(kinds).toContain('function');
    expect(kinds).toContain('symbol');
    expect(kinds).toContain('bigint');
    expect(kinds).toContain('object');
    expect(kinds).toContain('object');
    expect(root.children?.[5]?.children?.[0]?.kind).toBe('function');
  });

  it('survives hostile getters', () => {
    const evil = {
      get boom(): unknown {
        throw new Error('nope');
      },
      ok: 1,
    };
    const root = buildJsonTree(evil);
    expect(root.kind).toBe('object');
    expect((root.children ?? []).some((c) => c.key === 'ok')).toBe(true);
  });
});

describe('flattenJsonTree', () => {
  const tree = { a: { b: 1 }, list: [1, 2], s: 'short' };

  it('emits one row per visible node plus close rows for containers', () => {
    const rows = flattenJsonTree(buildJsonTree(tree), new Set());
    const keys = rows.map((r) => r.key);
    // root + a + a.b + close(a) + list + list.0 + list.1 + close(list) + s + close(root)
    expect(keys).toEqual([
      '#0',
      '.0#1',
      '.0.0#1',
      '.0#close',
      '.1#2',
      '.1.0#1',
      '.1.1#2',
      '.1#close',
      '.2#3',
      '#close',
    ]);
    expect(rows.at(-1)?.close).toBe(true);
    expect(rows.at(-1)?.last).toBe(true);
  });

  it('omits subtree rows for collapsed containers', () => {
    const rows = flattenJsonTree(buildJsonTree(tree), new Set(['.0']));
    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain('.0.0#1');
    expect(keys).not.toContain('.0#close');
    const a = rows.find((r) => r.node.id === '.0');
    expect(a?.collapsed).toBe(true);
    expect(a?.foldable).toBe(true);
  });

  it('renders empty containers as a single row (no close row)', () => {
    const rows = flattenJsonTree(buildJsonTree({ e: {}, l: [] }), new Set());
    expect(rows.map((r) => r.key)).toEqual(['#0', '.0#1', '.1#2', '#close']);
    expect(rows.find((r) => r.node.id === '.0')?.foldable).toBe(false);
  });

  it('long strings are foldable rows without children', () => {
    const rows = flattenJsonTree(buildJsonTree({ s: LONG }), new Set());
    const s = rows.find((r) => r.node.id === '.0');
    expect(s?.foldable).toBe(true);
    expect(s?.collapsed).toBe(false);
    const folded = flattenJsonTree(buildJsonTree({ s: LONG }), new Set(['.0']));
    expect(folded.find((r) => r.node.id === '.0')?.collapsed).toBe(true);
  });

  it('tracks last-child flags for comma rendering', () => {
    const rows = flattenJsonTree(buildJsonTree([1, 2]), new Set());
    const byId = new Map(rows.map((r) => [r.key, r]));
    expect(byId.get('.0#1')?.last).toBe(false);
    expect(byId.get('.1#2')?.last).toBe(true);
    expect(byId.get('#close')?.last).toBe(true);
  });
});

describe('collectFoldableIds', () => {
  it('collects containers with children and long strings', () => {
    const tree = buildJsonTree({ a: { b: 1 }, list: [], s: LONG, n: 3 });
    expect(collectFoldableIds(tree)).toEqual(['', '.0', '.2']);
  });

  it('returns just the root id for a bare long string', () => {
    expect(collectFoldableIds(buildJsonTree(LONG))).toEqual(['']);
  });

  it('is empty for scalars and empty containers', () => {
    expect(collectFoldableIds(buildJsonTree(42))).toEqual([]);
    expect(collectFoldableIds(buildJsonTree({}))).toEqual([]);
    expect(collectFoldableIds(buildJsonTree([]))).toEqual([]);
  });

  it('walks nested structures depth-first', () => {
    const tree: JsonTreeNode = buildJsonTree({ a: [{ b: { c: LONG } }] });
    const ids = collectFoldableIds(tree);
    expect(ids).toEqual(['', '.0', '.0.0', '.0.0.0', '.0.0.0.0']);
  });
});
