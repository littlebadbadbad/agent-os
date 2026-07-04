import React from 'react';
import type { GitCommit } from '../../api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import styles from './Git.module.scss';

interface CommitListProps {
  commits: GitCommit[];
  loading: boolean;
}

export function CommitList({ commits, loading }: CommitListProps) {
  if (loading) return <Spinner label="加载提交..." />;
  if (commits.length === 0) return <EmptyState icon="📝" title="暂无提交" />;

  return (
    <ul className={styles.commitList}>
      {commits.map((c) => (
        <li key={c.commitId} className={styles.commitItem}>
          <div className={styles.commitTop}>
            <code className={styles.commitHash}>{c.commitId.slice(0, 8)}</code>
            {c.changeCounts && (
              <span className={styles.changeCounts}>
                {c.changeCounts.add != null && (
                  <span className={styles.adds}>+{c.changeCounts.add}</span>
                )}
                {c.changeCounts.edit != null && (
                  <span className={styles.edits}>~{c.changeCounts.edit}</span>
                )}
                {c.changeCounts.delete != null && (
                  <span className={styles.dels}>-{c.changeCounts.delete}</span>
                )}
              </span>
            )}
          </div>
          <div className={styles.commitMsg}>{c.comment ?? '(无提交信息)'}</div>
          <div className={styles.commitMeta}>
            <span>{c.author?.name ?? c.committer?.name ?? '—'}</span>
            {c.author?.date && (
              <span>{new Date(c.author.date).toLocaleString('zh-CN')}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
