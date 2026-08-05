/**
 * internal-plugins/file/ui/panel/FileTree.tsx — Recursive workspace file tree
 *
 * Ported 1:1 from the devops plugin's editor file tree.
 */

import { useState, useCallback } from 'react';
import type { FileTreeNode } from '../api/workspaceApi';
import styles from './FileTree.module.scss';

// ── File icon map ──────────────────────────────────────────────────────────────

const EXT_ICONS: Record<string, string> = {
  ts: '󰛦',  tsx: '󰛦',  js: '󰌞',  jsx: '󰌞',
  json: '󰘦', html: '󰌝', css: '',  scss: '',
  less: '', md: '󰍔',  txt: '󰈙',  py: '󰌠',
  rs: '󱘗',  go: '󰟓',  java: '󰬷', cs: '󰌛',
  cpp: '󰙲', c: '󰙱',   sh: '󰆍',  bat: '󰆍',
  yml: '󰈙', yaml: '󰈙', toml: '󰈙', xml: '󰈙',
  svg: '󰜡', png: '󰋩',  jpg: '󰋩',  jpeg: '󰋩',
  gif: '󰋩', ico: '󰋩',  sql: '󰦏',  env: '󰈙',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? '󰈙';
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  readonly node: FileTreeNode;
  readonly depth: number;
  readonly parentPath: string;
  readonly activeFilePath: string | null;
  readonly onFileClick: (relPath: string) => void;
  readonly onExpandDir: (relPath: string) => Promise<readonly FileTreeNode[]>;
}

// ── TreeNode (recursive) ───────────────────────────────────────────────────────

function TreeNode({ node, depth, parentPath, activeFilePath, onFileClick, onExpandDir }: TreeNodeProps) {
  const relPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<readonly FileTreeNode[]>(node.children ?? []);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    if (node.type === 'file') {
      onFileClick(relPath);
      return;
    }
    if (!expanded) {
      if (children.length === 0) {
        setLoading(true);
        try {
          const nodes = await onExpandDir(relPath);
          setChildren(nodes);
        } finally {
          setLoading(false);
        }
      }
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [expanded, children, relPath, node.type, onFileClick, onExpandDir]);

  const isActive = node.type === 'file' && activeFilePath === relPath;
  const indent = depth * 12;

  return (
    <div className={styles.node}>
      <button
        className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={handleClick}
        title={relPath}
      >
        {node.type === 'directory' && (
          <span className={styles.arrow}>{expanded ? '▾' : '▸'}</span>
        )}
        {node.type === 'file' && <span className={styles.arrow} />}
        <span className={styles.icon}>
          {node.type === 'directory' ? (expanded ? '📂' : '📁') : getFileIcon(node.name)}
        </span>
        <span className={styles.name}>{node.name}</span>
        {loading && <span className={styles.spinner}>…</span>}
      </button>

      {node.type === 'directory' && expanded && (
        <div className={styles.children}>
          {children.map((child) => (
            <TreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              parentPath={relPath}
              activeFilePath={activeFilePath}
              onFileClick={onFileClick}
              onExpandDir={onExpandDir}
            />
          ))}
          {children.length === 0 && !loading && (
            <div className={styles.empty} style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}>
              空文件夹
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileTree ───────────────────────────────────────────────────────────────────

interface FileTreeProps {
  readonly nodes: readonly FileTreeNode[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly activeFilePath: string | null;
  readonly onFileClick: (relPath: string) => void;
  readonly onExpandDir: (relPath: string) => Promise<readonly FileTreeNode[]>;
  readonly onRefresh: () => void;
}

export function FileTree({ nodes, loading, error, activeFilePath, onFileClick, onExpandDir, onRefresh }: FileTreeProps) {
  return (
    <div className={styles.tree}>
      <div className={styles.treeHeader}>
        <span className={styles.treeTitle}>资源管理器</span>
        <button className={styles.refreshBtn} onClick={onRefresh} title="刷新">↻</button>
      </div>

      <div className={styles.treeBody}>
        {loading && <div className={styles.status}>加载中…</div>}
        {error && <div className={styles.statusError}>{error}</div>}
        {!loading && !error && nodes.length === 0 && (
          <div className={styles.status}>空文件夹</div>
        )}
        {!loading && nodes.map((node) => (
          <TreeNode
            key={node.name}
            node={node}
            depth={0}
            parentPath=""
            activeFilePath={activeFilePath}
            onFileClick={onFileClick}
            onExpandDir={onExpandDir}
          />
        ))}
      </div>
    </div>
  );
}
