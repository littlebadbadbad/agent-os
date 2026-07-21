import React from 'react';
import type { WorkItemUpdate } from '../../api';
import { Spinner } from '../shared/Spinner';
import styles from './WorkItems.module.scss';

const FIELD_LABEL_MAP: Record<string, string> = {
  'System.State': '状态',
  'System.AssignedTo': '负责人',
  'System.Title': '标题',
  'Microsoft.VSTS.Common.Priority': '优先级',
  'System.IterationPath': '迭代路径',
  'System.Description': '描述',
  'System.Tags': '标签',
};

function formatFieldVal(val: unknown): string {
  if (val === null || val === undefined) return '(空)';
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return String(obj['displayName'] ?? obj['name'] ?? JSON.stringify(val));
  }
  return String(val);
}

function UpdateRow({ update }: { update: WorkItemUpdate }) {
  const changedFields = update.fields
    ? Object.entries(update.fields)
        .filter(([, delta]) => delta.oldValue !== delta.newValue)
        .map(([key, delta]) => ({
          field: FIELD_LABEL_MAP[key] ?? key,
          old: formatFieldVal(delta.oldValue),
          new: formatFieldVal(delta.newValue),
        }))
    : [];

  if (changedFields.length === 0) return null;

  return (
    <li className={styles.historyItem}>
      <div className={styles.historyMeta}>
        <span className={styles.historyAuthor}>{update.revisedBy?.displayName ?? '系统'}</span>
        <span className={styles.historyDate}>
          {update.revisedDate ? new Date(update.revisedDate).toLocaleString('zh-CN') : ''}
        </span>
        <span className={styles.historyRev}>Rev {update.rev}</span>
      </div>
      <ul className={styles.historyFields}>
        {changedFields.map(({ field, old: o, new: n }) => (
          <li key={field} className={styles.historyField}>
            <span className={styles.historyFieldName}>{field}:</span>
            <span className={styles.historyOld}>{o}</span>
            <span className={styles.historyArrow}>→</span>
            <span className={styles.historyNew}>{n}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

interface WorkItemHistoryProps {
  updates: WorkItemUpdate[];
  loading: boolean;
}

export function WorkItemHistory({ updates, loading }: WorkItemHistoryProps) {
  return (
    <div className={styles.historyPane}>
      {loading ? (
        <Spinner size="sm" />
      ) : updates.length === 0 ? (
        <p className={styles.emptyText}>暂无历史记录</p>
      ) : (
        <ul className={styles.historyList}>
          {updates.map((u) => <UpdateRow key={u.rev} update={u} />)}
        </ul>
      )}
    </div>
  );
}
