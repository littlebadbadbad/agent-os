/**
 * jsonTree.ts — Chrome-DevTools-style structured model for arbitrary JS values.
 *
 * Builds the *node* model that powers the tree renderer (see JsonValue.tsx):
 *
 *   - every object property / array element is an individually foldable row,
 *   - long strings become foldable rows that collapse to a one-line preview,
 *   - collapsed containers summarise themselves as `{ … 12 }` / `[ … 4 ]`,
 *   - non-JSON runtime values (functions, symbols, bigint, circular refs) are
 *     rendered as inline sentinels rather than throwing.
 *
 * Total by construction: `buildJsonTree` never throws and always terminates,
 * even on deeply shared graphs (WeakSet memoisation + depth budget) or
 * Proxy/hostile objects.
 */

// ── Public types ──────────────────────────────────────────────────────────────

/** Token class → CSS module key in JsonValue.module.scss. */
export type JsonTokenClass = 'string' | 'number' | 'lit';

export type JsonTreeKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'function'
  | 'symbol'
  | 'bigint'
  | 'circular';

export type JsonTreeSegment = readonly [JsonTokenClass, string];

/** One foldable row of the tree. */
export interface JsonTreeNode {
  /** Stable hierarchical id: '' for the root, '.0', '.0.k', … */
  readonly id: string;
  /** Property name / array index; undefined for the root and bare values. */
  readonly key?: string;
  /** Nesting depth (root = 0). */
  readonly depth: number;
  /** True when this node is an array element (key is a numeric index). */
  readonly inArray?: boolean;
  readonly kind: JsonTreeKind;
  /** Present for object/array nodes; undefined when the container is empty. */
  readonly children?: readonly JsonTreeNode[];
  /** Raw string value (string nodes) — used for copy / full render. */
  readonly str?: string;
  /** True when a string node is long enough to be worth folding. */
  readonly longString?: boolean;
  /** Characters kept in the folded preview (long string nodes). */
  readonly previewLength?: number;
  /** Inline tokens for scalar leaves and sentinels. */
  readonly tokens?: readonly JsonTreeSegment[];
}

export interface BuildTreeOptions {
  /** Max nesting depth; deeper values collapse to a summary node. */
  readonly maxDepth?: number;
  /** Strings longer than this become foldable preview nodes. */
  readonly longStringChars?: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_LONG_STRING_CHARS = 120;

// ── Builder ───────────────────────────────────────────────────────────────────

class TreeBuilder {
  private readonly maxDepth: number;
  private readonly longString: number;
  /** Ancestor stack for circular detection (shared subtrees are fine). */
  private readonly ancestors = new WeakSet<object>();

  constructor(options: BuildTreeOptions | undefined) {
    this.maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.longString = options?.longStringChars ?? DEFAULT_LONG_STRING_CHARS;
  }

  build(value: unknown): JsonTreeNode {
    return this.node(value, '', 0, undefined, false);
  }

  private node(
    value: unknown,
    id: string,
    depth: number,
    key: string | undefined,
    inArray: boolean,
  ): JsonTreeNode {
    const kind = kindOf(value);

    if (kind === 'string') {
      const str = value as string;
      const long = depth <= this.maxDepth && str.length > this.longString;
      const preview = long ? this.longString : str.length;
      const tokens: JsonTreeSegment[] =
        depth > this.maxDepth
          ? [['string', `${str.slice(0, 60)}…(${str.length})`]]
          : long
            ? [['string', JSON.stringify(str.slice(0, preview)) + '…']]
            : [['string', JSON.stringify(str)]];
      return {
        id,
        key,
        depth,
        inArray: inArray || undefined,
        kind,
        str,
        longString: long || undefined,
        previewLength: long ? preview : undefined,
        tokens,
      };
    }

    if (kind === 'object' || kind === 'array') {
      const obj = value as Record<string, unknown> | unknown[];
      if (depth > this.maxDepth) {
        const size = Array.isArray(obj) ? obj.length : safeKeys(obj).length;
        const label = Array.isArray(obj) ? `[…${size}]` : `{…${size}}`;
        return { id, key, depth, inArray: inArray || undefined, kind: 'circular', tokens: [['lit', label]] };
      }
      if (this.ancestors.has(obj)) {
        return { id, key, depth, inArray: inArray || undefined, kind: 'circular', tokens: [['lit', '<circular>']] };
      }
      this.ancestors.add(obj);
      const children = Array.isArray(obj)
        ? this.arrayChildren(obj, id, depth)
        : this.objectChildren(obj, id, depth);
      this.ancestors.delete(obj);
      return { id, key, depth, inArray: inArray || undefined, kind, children };
    }

    // Scalar / exotic leaf — one inline token pair.
    return { id, key, depth, inArray: inArray || undefined, kind, tokens: [leafToken(value, kind)] };
  }

  private objectChildren(
    obj: Record<string, unknown>,
    id: string,
    depth: number,
  ): JsonTreeNode[] {
    const keys = safeKeys(obj);
    const out: JsonTreeNode[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      out.push(this.node(safeGet(obj, k), `${id}.${i}`, depth + 1, k, false));
    }
    return out;
  }

  private arrayChildren(arr: readonly unknown[], id: string, depth: number): JsonTreeNode[] {
    const out: JsonTreeNode[] = [];
    for (let i = 0; i < arr.length; i++) {
      out.push(this.node(safeGet(arr, i), `${id}.${i}`, depth + 1, String(i), true));
    }
    return out;
  }
}

function kindOf(value: unknown): JsonTreeKind {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'object':
      return Array.isArray(value) ? 'array' : 'object';
    case 'number':
    case 'boolean':
    case 'string':
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      return typeof value;
    default:
      return 'string';
  }
}

function leafToken(value: unknown, kind: JsonTreeKind): JsonTreeSegment {
  switch (kind) {
    case 'number':
      return ['number', String(value)];
    case 'boolean':
    case 'null':
      return ['lit', kind === 'null' ? 'null' : String(value)];
    case 'undefined':
      return ['lit', 'undefined'];
    case 'function':
      return ['lit', `[Function ${(value as { name?: string }).name || 'anonymous'}]`];
    case 'symbol':
      return ['lit', String((value as symbol).description ?? value)];
    case 'bigint':
      return ['number', `${String(value)}n`];
    default:
      return ['lit', String(value)];
  }
}

/** Object.keys that survives hostile getters / proxies. */
function safeKeys(obj: Record<string, unknown>): string[] {
  try {
    return Object.keys(obj);
  } catch {
    return [];
  }
}

/** Property read that survives throwing getters / proxies. */
function safeGet(obj: Record<string | number, unknown> | readonly unknown[], key: string | number): unknown {
  try {
    return (obj as Record<string | number, unknown>)[key];
  } catch {
    return undefined;
  }
}

export function buildJsonTree(value: unknown, options?: BuildTreeOptions): JsonTreeNode {
  return new TreeBuilder(options).build(value);
}

// ── Flattening ────────────────────────────────────────────────────────────────

/**
 * A visible row produced by walking the tree with a collapsed-id set.
 * Rows are generated lazily so folded subtrees cost nothing.
 */
export interface JsonTreeRow {
  /** Stable React key (node id + sibling index). */
  readonly key: string;
  readonly node: JsonTreeNode;
  /** True when this node has a fold toggle (children or long string). */
  readonly foldable: boolean;
  /** Current collapsed state of this node. */
  readonly collapsed: boolean;
  /** True when this row is its parent's last child (no trailing comma). */
  readonly last: boolean;
  /**
   * Present when this row closes an expanded container (the `}` / `]` line).
   * The node is the container being closed.
   */
  readonly close?: boolean;
}

export function flattenJsonTree(
  root: JsonTreeNode,
  collapsed: ReadonlySet<string>,
): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [];
  walk(root, collapsed, rows, 0, true);
  return rows;
}

function walk(
  node: JsonTreeNode,
  collapsed: ReadonlySet<string>,
  out: JsonTreeRow[],
  index: number,
  last: boolean,
): void {
  const children = node.children;
  const isContainer = children !== undefined;
  const foldable = isContainer ? (children?.length ?? 0) > 0 : node.longString === true;
  const isCollapsed = foldable && collapsed.has(node.id);

  out.push({ key: `${node.id}#${index}`, node, foldable, collapsed: isCollapsed, last });

  if (isCollapsed || !isContainer) return;
  if (children.length === 0) return; // empty containers render `{}` inline

  children.forEach((child, i) => walk(child, collapsed, out, i + 1, i === children.length - 1));
  out.push({
    key: `${node.id}#close`,
    node,
    foldable: true,
    collapsed: false,
    last,
    close: true,
  });
}

/** Ids of every foldable node — used to implement fold-all. */
export function collectFoldableIds(root: JsonTreeNode, into: string[] = []): string[] {
  const foldable =
    (root.children !== undefined && root.children.length > 0) || root.longString === true;
  if (foldable) into.push(root.id);
  root.children?.forEach((c) => collectFoldableIds(c, into));
  return into;
}
