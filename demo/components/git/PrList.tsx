import React from 'react';
import type { GitPullRequest, PullRequestThread } from '../../api';
import { prStatusBadge } from '../shared/Badge';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import styles from './Git.module.scss';

interface PrListProps {
  prs: GitPullRequest[];
  loading: boolean;
  prStatus: string;
  onStatusChange: (s: string) => void;
  expandedPrId: number | null;
  onToggleExpand: (id: number) => void;
  threadsMap: Record<number, PullRequestThread[]>;
  threadsLoading: boolean;
  newThreadText: string;
  onThreadTextChange: (text: string) => void;
  onPostThread: () => void;
  postingThread: boolean;
}

export function PrList({
  prs,
  loading,
  prStatus,
  onStatusChange,
  expandedPrId,
  onToggleExpand,
  threadsMap,
  threadsLoading,
  newThreadText,
  onThreadTextChange,
  onPostThread,
  postingThread,
}: PrListProps) {
  return (
    <div className={styles.prsPane}>
      <div className={styles.prsToolbar}>
        <select
          className={styles.select}
          value={prStatus}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="active">活跃</option>
          <option value="completed">已完成</option>
          <option value="abandoned">已放弃</option>
          <option value="all">全部</option>
        </select>
      </div>

      {loading ? (
        <Spinner label="加载 PR..." />
      ) : prs.length === 0 ? (
        <EmptyState icon="⑂" title="暂无 PR" />
      ) : (
        <ul className={styles.prList}>
          {prs.map((pr) => {
            const isExpanded = expandedPrId === pr.pullRequestId;
            const threads = threadsMap[pr.pullRequestId];
            return (
              <li key={pr.pullRequestId} className={styles.prItem}>
                <div
                  className={styles.prTop}
                  onClick={() => onToggleExpand(pr.pullRequestId)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={styles.prId}>!{pr.pullRequestId}</span>
                  {prStatusBadge(pr.status)}
                  {pr.isDraft && <span className={styles.draftBadge}>草稿</span>}
                  <span className={styles.threadToggle}>{isExpanded ? '▾ 收起' : '▸ 评论'}</span>
                </div>
                <div className={styles.prTitle}>{pr.title}</div>
                <div className={styles.prMeta}>
                  <span>
                    {pr.sourceRefName?.replace('refs/heads/', '')}
                    {' → '}
                    {pr.targetRefName?.replace('refs/heads/', '')}
                  </span>
                  <span>由 {pr.createdBy?.displayName ?? '—'} 创建</span>
                  {pr.creationDate && (
                    <span>{new Date(pr.creationDate).toLocaleDateString('zh-CN')}</span>
                  )}
                </div>
                {pr.reviewers && pr.reviewers.length > 0 && (
                  <div className={styles.reviewers}>
                    {pr.reviewers.map((r, i) => (
                      <span key={i} className={styles.reviewer} title={r.displayName}>
                        {r.displayName?.charAt(0).toUpperCase() ?? '?'}
                      </span>
                    ))}
                  </div>
                )}

                {isExpanded && (
                  <div className={styles.threadsPanel}>
                    {threadsLoading && threads === undefined ? (
                      <Spinner size="sm" />
                    ) : threads && threads.length > 0 ? (
                      <ul className={styles.threadList}>
                        {threads
                          .filter((t) => !t.isDeleted && t.comments && t.comments.length > 0)
                          .map((t) => (
                            <li key={t.id} className={styles.threadItem}>
                              {t.comments!.filter((c) => !c.isDeleted).map((c) => (
                                <div key={c.id} className={styles.threadComment}>
                                  <span className={styles.threadAuthor}>
                                    {c.author?.displayName ?? '未知'}
                                  </span>
                                  <span className={styles.threadDate}>
                                    {c.publishedDate
                                      ? new Date(c.publishedDate).toLocaleString('zh-CN')
                                      : ''}
                                  </span>
                                  <p className={styles.threadContent}>{c.content}</p>
                                </div>
                              ))}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className={styles.threadEmpty}>暂无讨论</p>
                    )}
                    <div className={styles.threadInput}>
                      <textarea
                        className={styles.threadTextarea}
                        placeholder="添加评论..."
                        value={newThreadText}
                        onChange={(e) => onThreadTextChange(e.target.value)}
                        rows={2}
                      />
                      <button
                        className={styles.threadSubmit}
                        onClick={onPostThread}
                        disabled={postingThread || !newThreadText.trim()}
                      >
                        {postingThread ? '发送中...' : '发送'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
