/**
 * JsonValue — Chrome-DevTools-style collapsible JSON tree renderer.
 *
 * Consumes the node model from jsonTree.ts and paints one row per visible
 * node: every object property, array element and long string carries its own
 * fold toggle, exactly like the Console's object inspector. Folded containers
 * summarise themselves inline (`{ … 12 }`), folded strings keep a preview plus
 * a `⋯ N 字符` badge.
 *
 * The component is fully controlled (collapsed ids + onToggle come from the
 * parent) so fold state can live in JsonViewer and survive row re-renders.
 * All layout/indentation is SCSS-driven — no inline styles.
 */

import { memo, useMemo } from 'react';
import type { ReactElement } from 'react';
import { flattenJsonTree } from './jsonTree';
import type { JsonTokenClass, JsonTreeNode, JsonTreeRow, JsonTreeSegment } from './jsonTree';
import styles from './JsonValue.module.scss';

interface JsonValueProps {
  readonly root: JsonTreeNode;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}

export function JsonValue({ root, collapsed, onToggle }: JsonValueProps): ReactElement {
  const rows = useMemo(() => flattenJsonTree(root, collapsed), [root, collapsed]);
  return (
    <div className={styles.tree}>
      {rows.map((row) => (
        <NodeRow key={row.key} row={row} onToggle={onToggle} />
      ))}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface NodeRowProps {
  readonly row: JsonTreeRow;
  readonly onToggle: (id: string) => void;
}

const NodeRow = memo(function NodeRow({ row, onToggle }: NodeRowProps): ReactElement {
  const { node, foldable, collapsed, last, close } = row;
  const toggle = foldable ? (): void => onToggle(node.id) : undefined;

  // Closing line of an expanded container: `}` / `]` (+ comma when needed).
  if (close) {
    return (
      <div className={styles.row}>
        <Indent depth={node.depth} />
        <span className={styles.gutter} />
        <code className={styles.line}>
          <span className={styles.punct}>{node.kind === 'array' ? ']' : '}'}</span>
          {!last && <span className={styles.punct}>,</span>}
        </code>
      </div>
    );
  }

  const isContainer = node.children !== undefined;
  const emptyContainer = isContainer && (node.children?.length ?? 0) === 0;
  // Expanded non-empty containers show their comma on the closing line instead.
  const commaHere = !last && !(isContainer && !collapsed && !emptyContainer);

  return (
    <div className={styles.row}>
      <Indent depth={node.depth} />
      <span className={styles.gutter}>
        {foldable && (
          <button
            type="button"
            className={styles.foldBtn}
            onClick={toggle}
            title={collapsed ? '展开' : '折叠'}
            aria-expanded={!collapsed}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
      </span>
      <code className={styles.line} onClick={toggle}>
        {node.key !== undefined && (
          <>
            <span className={node.inArray ? styles.index : styles.key}>
              {node.inArray ? `[${node.key}]` : node.key}
            </span>
            <span className={styles.punct}>: </span>
          </>
        )}
        <Value node={node} collapsed={collapsed} />
        {collapsed && (
          <button
            type="button"
            className={styles.foldBadge}
            onClick={() => onToggle(node.id)}
            title="展开"
          >
            {node.kind === 'string'
              ? `⋯ 还有 ${hiddenChars(node)} 字符`
              : `⋯ ${node.children?.length ?? 0} ${node.kind === 'array' ? '项' : '字段'}`}
          </button>
        )}
        {collapsed && isContainer && (
          <span className={styles.punct}>{node.kind === 'array' ? ']' : '}'}</span>
        )}
        {!collapsed && emptyContainer && (
          <span className={styles.punct}>{node.kind === 'array' ? '[]' : '{}'}</span>
        )}
        {commaHere && <span className={styles.punct}>,</span>}
      </code>
    </div>
  );
});

/** Characters hidden by folding a long-string node behind its preview. */
function hiddenChars(node: JsonTreeNode): number {
  return Math.max(0, (node.str?.length ?? 0) - (node.previewLength ?? 0));
}

/** Value portion of a row (brackets for containers, tokens for scalars). */
function Value({ node, collapsed }: { readonly node: JsonTreeNode; readonly collapsed: boolean }): ReactElement {
  if (node.kind === 'object' || node.kind === 'array') {
    const children = node.children?.length ?? 0;
    if (children === 0) return <></>; // `{}` / `[]` rendered by the row itself
    return <span className={styles.punct}>{node.kind === 'array' ? '[' : '{'}</span>;
  }
  if (node.kind === 'string') {
    // Long strings keep the model's truncated preview while folded;
    // expanded (or short) strings render in full.
    if (node.longString && collapsed) return <Tokens segments={node.tokens ?? []} />;
    return <span className={styles.tString}>{JSON.stringify(node.str ?? '')}</span>;
  }
  return <Tokens segments={node.tokens ?? []} />;
}

function Tokens({ segments }: { readonly segments: readonly JsonTreeSegment[] }): ReactElement {
  return (
    <>
      {segments.map(([cls, text], i) => (
        <span key={i} className={tokenClass(cls)}>
          {text}
        </span>
      ))}
    </>
  );
}

function tokenClass(cls: JsonTokenClass): string {
  switch (cls) {
    case 'string':
      return styles.tString;
    case 'number':
      return styles.tNumber;
    default:
      return styles.tPunct;
  }
}

// ── Indentation ───────────────────────────────────────────────────────────────

/** Depth indentation via repeated monospace cells — keeps all styling in SCSS. */
const INDENT_CACHE: readonly string[] = Array.from({ length: 33 }, (_, d) => '\u00A0\u00A0'.repeat(d));

function Indent({ depth }: { readonly depth: number }): ReactElement {
  const clamped = depth > 32 ? 32 : depth;
  return <span aria-hidden className={styles.indent}>{INDENT_CACHE[clamped]}</span>;
}
