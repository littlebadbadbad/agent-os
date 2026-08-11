import React from 'react';
import type { WorkItemAttachment } from '../../api';
import styles from './WorkItems.module.scss';

interface WorkItemAttachmentTabProps {
  uploading: boolean;
  result: WorkItemAttachment | null;
  error: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function WorkItemAttachmentTab({
  uploading,
  result,
  error,
  onFileChange,
}: WorkItemAttachmentTabProps) {
  return (
    <div className={styles.attachmentsPane}>
      <p className={styles.attachHint}>选择文件上传为工作项附件</p>
      <label className={styles.attachLabel}>
        <input
          type="file"
          className={styles.attachInput}
          onChange={onFileChange}
          disabled={uploading}
        />
        <span className={styles.attachBtn}>
          {uploading ? '上传中...' : '📎 选择文件'}
        </span>
      </label>
      {error && <div className={styles.attachError}>⚠ {error}</div>}
      {result && (
        <div className={styles.attachSuccess}>
          ✓ 已上传：
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            {result.fileName ?? result.id}
          </a>
        </div>
      )}
    </div>
  );
}
