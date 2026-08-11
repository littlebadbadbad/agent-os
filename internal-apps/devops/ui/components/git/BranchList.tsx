import React from 'react';
import type { GitRef, GitRepo } from '../../api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import styles from './Git.module.scss';

interface BranchListProps {
  branches: GitRef[];
  loading: boolean;
  selectedRepo: GitRepo | undefined;
  onSelectBranch: (name: string) => void;
}

export function BranchList({ branches, loading, selectedRepo, onSelectBranch }: BranchListProps) {
  if (loading) return <Spinner label="加载分支..." />;
  if (branches.length === 0) return <EmptyState icon="⑂" title="暂无分支" />;

  const defaultName = selectedRepo?.defaultBranch?.replace('refs/heads/', '');

  return (
    <ul className={styles.branchList}>
      {branches.map((b) => {
        const name = b.name.replace('refs/heads/', '');
        const isDefault = name === defaultName;
        return (
          <li key={b.name} className={styles.branchItem}>
            <span
              className={`${styles.branchName} ${styles.branchNameClickable}`}
              onClick={() => onSelectBranch(name)}
              title={`切换到 ${name} 的文件视图`}
            >
              {name}
            </span>
            {isDefault && <span className={styles.defaultTag}>默认</span>}
            <code className={styles.branchHash}>{b.objectId.slice(0, 8)}</code>
          </li>
        );
      })}
    </ul>
  );
}