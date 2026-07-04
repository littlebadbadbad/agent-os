import React from 'react';
import type { WorkItem, WorkItemFieldDef } from '../../api';
import { workItemStateBadge } from '../shared/Badge';
import styles from './WorkItems.module.scss';

export function WorkItemDetail({ item, fieldDefs = [] }: { item: WorkItem; fieldDefs?: WorkItemFieldDef[] }) {
  const parentLabel = item.parentId != null
    ? `#${item.parentId}${item.parentTitle ? `  ${item.parentTitle}` : ''}`
    : '—';

  /** Resolve a human-readable name for a custom field reference. */
  function fieldLabel(ref: string): string {
    const def = fieldDefs.find((f) => f.referenceName === ref);
    return def?.name ?? ref.replace(/^Custom\./, '');
  }

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: '状态', value: workItemStateBadge(item.state) },
    { label: '负责人', value: item.assignedTo ?? '未分配' },
    { label: '优先级', value: item.priority != null ? String(item.priority) : '—' },
    { label: '父工作项', value: parentLabel },
    { label: '迭代路径', value: item.iterationPath ?? '—' },
    { label: '区域路径', value: item.areaPath ?? '—' },
    { label: '标签', value: item.tags || '—' },
    // Scheduling
    { label: '原始估算', value: item.originalEstimate != null ? String(item.originalEstimate) : '—' },
    { label: '工作量', value: item.effort != null ? String(item.effort) : '—' },
    { label: '剩余工时', value: item.remainingWork != null ? String(item.remainingWork) : '—' },
    { label: '已完成工时', value: item.completedWork != null ? String(item.completedWork) : '—' },
    ...(item.storyPoints != null ? [{ label: '故事点', value: String(item.storyPoints) }] : []),
    ...(item.businessValue != null ? [{ label: '业务价值', value: String(item.businessValue) }] : []),
    ...(item.startDate ? [{ label: '开始日期', value: item.startDate.slice(0, 10) }] : []),
    ...(item.finishDate ? [{ label: '完成日期', value: item.finishDate.slice(0, 10) }] : []),
    ...(item.targetDate ? [{ label: '目标日期', value: item.targetDate.slice(0, 10) }] : []),
    // Common metadata
    ...(item.severity ? [{ label: '严重程度', value: item.severity }] : []),
    ...(item.activity ? [{ label: '活动类型', value: item.activity }] : []),
    ...(item.valueArea ? [{ label: '价值域', value: item.valueArea }] : []),
  ];

  if (item.customFields) {
    for (const [key, val] of Object.entries(item.customFields)) {
      rows.push({ label: fieldLabel(key), value: String(val ?? '—') });
    }
  }

  return (
    <div className={styles.detailPane}>
      <dl className={styles.fieldGrid}>
        {rows.map(({ label, value }) => (
          <React.Fragment key={label}>
            <dt className={styles.fieldLabel}>{label}</dt>
            <dd className={styles.fieldValue}>{value}</dd>
          </React.Fragment>
        ))}
      </dl>

      {item.children && item.children.length > 0 && (
        <div className={styles.descSection}>
          <h4 className={styles.descHeading}>子工作项（{item.children.length}）</h4>
          <ul className={styles.childrenList}>
            {item.children.map((child) => (
              <li key={child.id} className={styles.childrenItem}>
                <span className={styles.childId}>#{child.id}</span>
                {child.type && <span className={styles.childType}>{child.type}</span>}
                <span className={styles.childTitle}>{child.title}</span>
                {child.state && <span className={styles.childState}>{child.state}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.description && (
        <div className={styles.descSection}>
          <h4 className={styles.descHeading}>描述</h4>
          <div className="ado-html-content" dangerouslySetInnerHTML={{ __html: item.description }} />
        </div>
      )}

      {item.acceptanceCriteria && (
        <div className={styles.descSection}>
          <h4 className={styles.descHeading}>验收标准</h4>
          <div className="ado-html-content" dangerouslySetInnerHTML={{ __html: item.acceptanceCriteria }} />
        </div>
      )}
    </div>
  );
}
