import React from 'react';
import type { WorkItem } from '../../api';
import { workItemStateBadge } from '../shared/Badge';
import styles from './WorkItems.module.scss';

interface WorkItemTableProps {
  items: WorkItem[];
  onRowClick: (id: number) => void;
  selectedId: number | null;
}

const PRIORITY_LABELS: Record<number, string> = {
  1: '⬆ 紧急',
  2: '↑ 高',
  3: '→ 中',
  4: '↓ 低',
};

const TYPE_COLORS: Record<string, string> = {
  Epic: '#ff7b6e',
  Feature: '#773b93',
  'Product Backlog Item': '#009ccc',
  Bug: '#cc293d',
  Task: '#f2cb1d',
  'Test Case': '#004b50',
  Issue: '#e60017',
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? '#8b949e';
}

export function WorkItemTable({ items, onRowClick, selectedId }: WorkItemTableProps) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thId}>ID</th>
            <th className={styles.thType}>类型</th>
            <th className={styles.thTitle}>标题</th>
            <th className={styles.thState}>状态</th>
            <th className={styles.thAssignee}>负责人</th>
            <th className={styles.thPriority}>优先级</th>
            <th className={styles.thIter}>迭代</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={`${styles.row} ${selectedId === item.id ? styles.rowSelected : ''}`}
              onClick={() => onRowClick(item.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onRowClick(item.id);
              }}
            >
              <td className={styles.tdId}>
                <a
                  className={styles.idLink}
                  onClick={(e) => e.stopPropagation()}
                >
                  #{item.id}
                </a>
              </td>
              <td className={styles.tdType}>
                <span
                  className={styles.typeChip}
                  style={{ background: typeColor(item.type) + '22', color: typeColor(item.type) }}
                >
                  {item.type}
                </span>
              </td>
              <td className={styles.tdTitle}>
                <span className={styles.titleText}>{item.title}</span>
                {item.tags && (
                  <span className={styles.tags}>
                    {item.tags
                      .split(';')
                      .filter(Boolean)
                      .map((t) => (
                        <span key={t} className={styles.tag}>
                          {t.trim()}
                        </span>
                      ))}
                  </span>
                )}
              </td>
              <td className={styles.tdState}>{workItemStateBadge(item.state)}</td>
              <td className={styles.tdAssignee}>
                {item.assignedTo ? (
                  <span className={styles.assignee}>{item.assignedTo}</span>
                ) : (
                  <span className={styles.unassigned}>—</span>
                )}
              </td>
              <td className={styles.tdPriority}>
                {item.priority != null ? (
                  <span className={styles.priority}>{PRIORITY_LABELS[item.priority] ?? item.priority}</span>
                ) : (
                  <span className={styles.unassigned}>—</span>
                )}
              </td>
              <td className={styles.tdIter}>
                {item.iterationPath ? (
                  <span className={styles.iterPath} title={item.iterationPath}>
                    {item.iterationPath.split('\\').pop()}
                  </span>
                ) : (
                  <span className={styles.unassigned}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
