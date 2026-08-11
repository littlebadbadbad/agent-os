import React from 'react';
import type { WorkItemComment } from '../../api';
import { Spinner } from '../shared/Spinner';
import styles from './WorkItems.module.scss';

interface WorkItemCommentsProps {
  comments: WorkItemComment[];
  loading: boolean;
  commentText: string;
  submitting: boolean;
  onTextChange: (t: string) => void;
  onSubmit: () => void;
}

export function WorkItemComments({
  comments,
  loading,
  commentText,
  submitting,
  onTextChange,
  onSubmit,
}: WorkItemCommentsProps) {
  return (
    <div className={styles.commentsPane}>
      <div className={styles.commentInput}>
        <textarea
          className={styles.commentTextarea}
          placeholder="添加评论..."
          value={commentText}
          onChange={(e) => onTextChange(e.target.value)}
          rows={3}
        />
        <button
          className={styles.commentSubmit}
          onClick={onSubmit}
          disabled={submitting || !commentText.trim()}
        >
          {submitting ? '发送中...' : '发送'}
        </button>
      </div>
      {loading ? (
        <Spinner size="sm" />
      ) : comments.length === 0 ? (
        <p className={styles.emptyText}>暂无评论</p>
      ) : (
        <ul className={styles.commentList}>
          {comments.map((c) => (
            <li key={c.id} className={styles.commentItem}>
              <div className={styles.commentMeta}>
                <span className={styles.commentAuthor}>{c.createdBy?.displayName ?? '未知'}</span>
                <span className={styles.commentDate}>
                  {c.createdDate ? new Date(c.createdDate).toLocaleString('zh-CN') : ''}
                </span>
              </div>
              <div
                className={`ado-html-content ${styles.commentText}`}
                dangerouslySetInnerHTML={{ __html: c.text }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
