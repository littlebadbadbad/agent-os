import React from 'react';
import type { Build, BuildArtifact } from '../../api';
import { buildResultBadge } from '../shared/Badge';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { ArtifactChip, calcDuration } from './ArtifactChip';
import styles from './Builds.module.scss';

interface RunsTableProps {
  runs: Build[];
  loading: boolean;
  expandedRunId: number | null;
  artifactsMap: Record<number, BuildArtifact[]>;
  artifactsLoading: boolean;
  onToggleExpand: (runId: number) => void;
}

export function RunsTable({
  runs,
  loading,
  expandedRunId,
  artifactsMap,
  artifactsLoading,
  onToggleExpand,
}: RunsTableProps) {
  if (loading) return <Spinner label="加载构建记录..." />;
  if (runs.length === 0) return <EmptyState icon="🏗" title="暂无构建记录" />;

  return (
    <div className={styles.runsTableWrapper}>
      <table className={styles.runsTable}>
        <thead>
          <tr>
            <th className={styles.thExpand} />
            <th>构建号</th>
            <th>结果</th>
            <th>分支</th>
            <th>触发人</th>
            <th>开始时间</th>
            <th>耗时</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isExpanded = expandedRunId === run.id;
            const artifacts = artifactsMap[run.id];
            return (
              <React.Fragment key={run.id}>
                <tr className={`${styles.runRow} ${isExpanded ? styles.runRowExpanded : ''}`}>
                  <td className={styles.tdExpand}>
                    <button
                      className={styles.expandBtn}
                      onClick={() => onToggleExpand(run.id)}
                      title="查看制品"
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className={styles.runNumber}>
                    {run.url ? (
                      <a href={run.url} target="_blank" rel="noopener noreferrer">
                        {run.buildNumber}
                      </a>
                    ) : (
                      run.buildNumber
                    )}
                  </td>
                  <td>{buildResultBadge(run.status, run.result)}</td>
                  <td className={styles.runBranch}>
                    {run.sourceBranch?.replace('refs/heads/', '') ?? '—'}
                  </td>
                  <td className={styles.runRequester}>
                    {run.requestedFor?.displayName ?? run.requestedBy?.displayName ?? '—'}
                  </td>
                  <td className={styles.runTime}>
                    {run.startTime ? new Date(run.startTime).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className={styles.runDuration}>
                    {calcDuration(run.startTime, run.finishTime)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className={styles.artifactsRow}>
                    <td colSpan={7}>
                      {artifactsLoading && artifacts === undefined ? (
                        <div className={styles.artifactLoading}><Spinner size="sm" /></div>
                      ) : !artifacts || artifacts.length === 0 ? (
                        <div className={styles.artifactEmpty}>暂无制品</div>
                      ) : (
                        <div className={styles.artifactList}>
                          {artifacts.map((a) => <ArtifactChip key={a.id} artifact={a} />)}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
