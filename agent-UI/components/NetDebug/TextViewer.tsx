/**
 * TextViewer — foldable viewer for long plain text (concatenated stream
 * output). The text is split into blocks at line boundaries (hard-split when
 * a single line is huge); every block folds independently with a one-line
 * preview + hidden-characters badge, so a 100 KB token stream stays skimmable.
 *
 * Purely presentational; fold state is local. All styling in
 * TextViewer.module.scss.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { splitBlocks, PREVIEW_CHARS } from './textBlocks';
import type { TextBlock } from './textBlocks';
import styles from './TextViewer.module.scss';

interface TextViewerProps {
  readonly text: string;
  /** Start folded — used when the whole text is long. */
  readonly collapsedByDefault?: boolean;
}

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

export function TextViewer({ text, collapsedByDefault = false }: TextViewerProps): ReactElement {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  const foldable = useMemo(
    () => blocks.map((b, i) => i).filter((i) => blocks[i].content.length > PREVIEW_CHARS),
    [blocks],
  );

  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(
    collapsedByDefault ? new Set(foldable) : EMPTY_SET,
  );

  const toggle = useCallback((index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text);
  }, [text]);

  const allFolded = foldable.length > 0 && collapsed.size >= foldable.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => setCollapsed(allFolded ? EMPTY_SET : new Set(foldable))}
          disabled={foldable.length === 0}
          title={allFolded ? '全部展开' : '全部折叠'}
        >
          {allFolded ? '⊞' : '⊟'}
        </button>
        <span className={styles.toolInfo}>
          {text.length.toLocaleString()} 字符 · {blocks.length} 段
        </span>
        <button type="button" className={styles.toolBtn} onClick={copy} title="复制全文">
          复制
        </button>
      </div>
      <div className={styles.body}>
        {blocks.map((block, i) => (
          <BlockRow
            key={block.start}
            block={block}
            collapsed={collapsed.has(i)}
            foldable={block.content.length > PREVIEW_CHARS}
            onToggle={() => toggle(i)}
          />
        ))}
      </div>
    </div>
  );
}

interface BlockRowProps {
  readonly block: TextBlock;
  readonly collapsed: boolean;
  readonly foldable: boolean;
  readonly onToggle: () => void;
}

function BlockRow({ block, collapsed, foldable, onToggle }: BlockRowProps): ReactElement {
  const toggle = foldable ? onToggle : undefined;
  return (
    <div className={styles.block} onClick={toggle}>
      <span className={styles.blockNo}>{block.start + 1}–{block.end}</span>
      {collapsed ? (
        <span className={styles.preview}>
          {escapeWs(block.content.slice(0, PREVIEW_CHARS))}
          <span className={styles.foldBadge}>⋯ 还有 {block.content.length - PREVIEW_CHARS} 字符</span>
        </span>
      ) : (
        <pre className={styles.content}>{block.content}</pre>
      )}
    </div>
  );
}

/** Keep folded previews on one line without losing visible whitespace hints. */
function escapeWs(s: string): string {
  return s.replace(/\n/g, '↵ ').replace(/\r/g, '');
}
