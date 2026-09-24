/**
 * JsonViewer — interactive read-only JSON inspector for captured payloads.
 *
 * Renders any runtime value as a Chrome-DevTools-style collapsible tree
 * (see JsonValue.tsx / jsonTree.ts): every field, array element and long
 * string folds independently; folded containers summarise themselves inline.
 *
 * Purely presentational: the tree model is rebuilt via useMemo only when the
 * value identity changes; folding is local UI state keyed by node id, so it
 * survives store-driven re-renders. `safeStringify` remains exported for the
 * copy button and stream previews.
 * All sizing/spacing lives in JsonViewer.module.scss (no inline styles).
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { buildJsonTree, collectFoldableIds } from './jsonTree';
import { JsonValue } from './JsonValue';
import styles from './JsonViewer.module.scss';

interface JsonViewerProps {
  readonly value: unknown;
  /** Placeholder text when the value is undefined. */
  readonly emptyText?: string;
  /** Compact variant (smaller scroll box) for repeated previews like chunks. */
  readonly compact?: boolean;
}

/** Shared immutable empty set — avoids re-allocating per viewer instance. */
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Safely stringify an unknown value, tolerating circular refs and odd types. */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      value,
      (_key: string, val: unknown) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        if (typeof val === 'function') return '[Function]';
        if (typeof val === 'symbol') return `[Symbol:${String(val.description ?? '')}]`;
        if (typeof val === 'bigint') return `${val}n`;
        return val;
      },
      2,
    );
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

export function JsonViewer({
  value,
  emptyText = '—',
  compact = false,
}: JsonViewerProps): ReactElement {
  const root = useMemo(() => buildJsonTree(value), [value]);
  const foldableIds = useMemo(() => collectFoldableIds(root), [root]);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY_SET);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(safeStringify(value));
  }, [value]);

  const allFolded = foldableIds.length > 0 && collapsed.size >= foldableIds.length;

  return (
    <div className={compact ? styles.wrapCompact : styles.wrap}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => setCollapsed(allFolded ? EMPTY_SET : new Set(foldableIds))}
          disabled={foldableIds.length === 0}
          title={allFolded ? '全部展开' : '全部折叠'}
        >
          {allFolded ? '⊞' : '⊟'}
        </button>
        <span className={styles.toolInfo}>{foldableIds.length} 可折叠</span>
        <button type="button" className={styles.toolBtn} onClick={copy} title="复制 JSON">
          复制
        </button>
      </div>
      <div className={styles.body}>
        {value === undefined ? <div className={styles.empty}>{emptyText}</div> : (
          <JsonValue root={root} collapsed={collapsed} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}
