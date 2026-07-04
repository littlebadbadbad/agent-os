import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchItems, fetchFileContent } from '../../api';
import type { GitItem, GitCommit } from '../../api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import styles from './Git.module.scss';

interface FileTreeBrowserProps {
  collectionUrl: string;
  project: string;
  pat: string;
  repoId: string | null;
  treeBranch: string;
  dirCache: Record<string, GitItem[] | null>;
  setDirCache: React.Dispatch<React.SetStateAction<Record<string, GitItem[] | null>>>;
  expandedDirs: Set<string>;
  setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
  commits: GitCommit[];
  commitsLoading: boolean;
}

type RightTab = 'file' | 'commits';

export function FileTreeBrowser({
  collectionUrl,
  project,
  pat,
  repoId,
  treeBranch,
  dirCache,
  setDirCache,
  expandedDirs,
  setExpandedDirs,
  commits,
  commitsLoading,
}: FileTreeBrowserProps) {
  const [viewedFile, setViewedFile] = useState<{ path: string; content: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('commits');

  useEffect(() => {
    setViewedFile(null);
    setFileError(null);
  }, [repoId, treeBranch]);

  const loadDir = useCallback(
    async (path: string) => {
      if (!repoId) return;
      setDirCache((prev) => ({ ...prev, [path]: null }));
      try {
        const items = await fetchItems(
          collectionUrl, project, pat, repoId, path, treeBranch || undefined,
        );
        setDirCache((prev) => ({ ...prev, [path]: items.filter((i) => i.path !== path) }));
      } catch (e) {
        setDirCache((prev) => { const n = { ...prev }; delete n[path]; return n; });
        setFileError(e instanceof Error ? e.message : String(e));
      }
    },
    [collectionUrl, project, pat, repoId, treeBranch, setDirCache],
  );

  const autoLoadKey = useRef('');
  useEffect(() => {
    if (!repoId || !treeBranch) return;
    const key = `${repoId}:${treeBranch}`;
    if (autoLoadKey.current === key) return;
    autoLoadKey.current = key;
    setDirCache({});
    setExpandedDirs(new Set(['/']));
    loadDir('/');
  }, [repoId, treeBranch, loadDir, setDirCache, setExpandedDirs]);

  async function handleItemClick(item: GitItem) {
    const path = item.path ?? '/';
    if (item.isFolder) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) { next.delete(path); }
        else { next.add(path); if (dirCache[path] === undefined) loadDir(path); }
        return next;
      });
    } else {
      if (!repoId) return;
      setFileLoading(true);
      setFileError(null);
      setViewedFile(null);
      setRightTab('file');
      try {
        const content = await fetchFileContent(
          collectionUrl, project, pat, repoId, path, treeBranch || undefined,
        );
        setViewedFile({ path, content });
      } catch (e) {
        setFileError(e instanceof Error ? e.message : String(e));
      } finally {
        setFileLoading(false);
      }
    }
  }

  const treeReady = dirCache['/'] !== undefined;

  return (
    <div className={styles.ghLayout}>
      {/* ── Left: tree sidebar ── */}
      <aside className={styles.ghTree}>
        <div className={styles.ghTreeHeader}>
          <span className={styles.ghTreeTitle}>文件树</span>
          <button
            className={styles.ghRefreshBtn}
            title="刷新"
            onClick={() => { setDirCache({}); setExpandedDirs(new Set(['/'])); loadDir('/'); }}
            disabled={!repoId || !treeBranch}
          >
            ↻
          </button>
        </div>
        <div className={styles.ghTreeScroll}>
          {!repoId || !treeBranch ? (
            <div className={styles.ghTreeEmpty}>请选择仓库和分支</div>
          ) : !treeReady ? (
            <div className={styles.ghTreeEmpty}><Spinner size="sm" /></div>
          ) : (
            <FileTree
              items={dirCache['/'] ?? []}
              loading={dirCache['/'] === null}
              dirCache={dirCache}
              expandedDirs={expandedDirs}
              selectedPath={viewedFile?.path ?? null}
              onItemClick={handleItemClick}
              depth={0}
            />
          )}
        </div>
      </aside>

      {/* ── Right: content area ── */}
      <main className={styles.ghContent}>
        <div className={styles.ghContentTabs}>
          <button
            className={`${styles.ghContentTab} ${rightTab === 'file' ? styles.ghContentTabActive : ''}`}
            onClick={() => setRightTab('file')}
          >
            {viewedFile ? viewedFile.path.split('/').pop() : '文件内容'}
          </button>
          <button
            className={`${styles.ghContentTab} ${rightTab === 'commits' ? styles.ghContentTabActive : ''}`}
            onClick={() => setRightTab('commits')}
          >
            提交记录
            {commits.length > 0 && (
              <span className={styles.ghCommitCount}>{commits.length}</span>
            )}
          </button>
        </div>

        <div className={styles.ghContentBody}>
          {rightTab === 'file' ? (
            <>
              {fileLoading && (
                <div className={styles.ghFileLoading}><Spinner label="加载中..." /></div>
              )}
              {fileError && (
                <div className={styles.ghFileError}>⚠ {fileError}</div>
              )}
              {!fileLoading && !viewedFile && !fileError && (
                <EmptyState icon="📄" title="点击左侧文件查看内容" />
              )}
              {viewedFile && (
                <div className={styles.ghFileContent}>
                  <div className={styles.ghFilePath}>{viewedFile.path}</div>
                  <pre className={styles.ghFileCode}>{viewedFile.content}</pre>
                </div>
              )}
            </>
          ) : (
            <div className={styles.ghCommitList}>
              {commitsLoading ? (
                <Spinner label="加载提交..." />
              ) : commits.length === 0 ? (
                <EmptyState icon="📝" title="暂无提交记录" />
              ) : commits.map((c) => (
                <div key={c.commitId} className={styles.ghCommitItem}>
                  <div className={styles.ghCommitTop}>
                    <code className={styles.ghCommitHash}>{c.commitId.slice(0, 8)}</code>
                    {c.changeCounts && (
                      <span className={styles.ghChangeCounts}>
                        {c.changeCounts.add != null && c.changeCounts.add > 0 && (
                          <span className={styles.ghAdds}>+{c.changeCounts.add}</span>
                        )}
                        {c.changeCounts.edit != null && c.changeCounts.edit > 0 && (
                          <span className={styles.ghEdits}>~{c.changeCounts.edit}</span>
                        )}
                        {c.changeCounts.delete != null && c.changeCounts.delete > 0 && (
                          <span className={styles.ghDels}>-{c.changeCounts.delete}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className={styles.ghCommitMsg}>{c.comment ?? '(无提交信息)'}</div>
                  <div className={styles.ghCommitMeta}>
                    <span>{c.author?.name ?? c.committer?.name ?? '—'}</span>
                    {c.author?.date && (
                      <span>{new Date(c.author.date).toLocaleString('zh-CN')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Recursive tree ────────────────────────────────────────────────────────────

interface FileTreeProps {
  items: GitItem[];
  loading: boolean;
  dirCache: Record<string, GitItem[] | null>;
  expandedDirs: Set<string>;
  selectedPath: string | null;
  onItemClick: (item: GitItem) => void;
  depth: number;
}

function FileTree({ items, loading, dirCache, expandedDirs, selectedPath, onItemClick, depth }: FileTreeProps) {
  if (loading) return <div className={styles.treeLoading}><Spinner size="sm" /></div>;
  if (items.length === 0) return <div className={styles.treeEmpty}>(空目录)</div>;

  return (
    <ul className={styles.treeList} style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {items.map((item) => {
        const path = item.path ?? '';
        const name = path.split('/').filter(Boolean).pop() ?? path;
        const isDir = item.isFolder;
        const isExpanded = isDir && expandedDirs.has(path);
        const isSelected = !isDir && path === selectedPath;
        const children = dirCache[path];

        return (
          <li key={path} className={styles.treeItem}>
            <div
              className={[
                styles.treeRow,
                isDir ? styles.treeRowDir : styles.treeRowFile,
                isSelected ? styles.treeRowSelected : '',
              ].join(' ')}
              onClick={() => onItemClick(item)}
            >
              <span className={styles.treeIcon}>
                {isDir ? (isExpanded ? '📂' : '📁') : '📄'}
              </span>
              <span className={styles.treeName}>{name}</span>
            </div>
            {isExpanded && children !== undefined && (
              <FileTree
                items={children ?? []}
                loading={children === null}
                dirCache={dirCache}
                expandedDirs={expandedDirs}
                selectedPath={selectedPath}
                onItemClick={onItemClick}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
