/**
 * NetTable — the DevTools-style request list for recorded network entries.
 *
 * One row per `call()` / `connectStream()`: status, kind, app, name, timing,
 * and payload size. Clicking a row selects it for the detail pane.
 */

import type { ReactElement } from 'react';
import type { NetLogEntry } from '../../store/netLog';
import { formatBytes, formatDuration, formatTime } from './format';
import styles from './NetTable.module.scss';

interface NetTableProps {
  readonly entries: readonly NetLogEntry[];
  readonly selectedId: number | null;
  readonly onSelect: (id: number) => void;
}

export function NetTable({ entries, selectedId, onSelect }: NetTableProps): ReactElement {
  if (entries.length === 0) {
    return <div className={styles.empty}>暂无网络记录</div>;
  }

  return (
    <div className={styles.scroll} role="log">
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colStatus}>{' '}</th>
            <th className={styles.colKind}>类型</th>
            <th className={styles.colApp}>App</th>
            <th className={styles.colName}>名称</th>
            <th className={styles.colTime}>时间</th>
            <th className={styles.colDuration}>耗时</th>
            <th className={styles.colSize}>数据</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className={entry.id === selectedId ? styles.rowSelected : styles.row}
              onClick={() => onSelect(entry.id)}
            >
              <td className={styles.colStatus}>
                <span className={styles.statusDot} data-status={statusKey(entry)} />
              </td>
              <td className={styles.colKind}>
                <span className={styles.kindBadge} data-kind={entry.kind}>
                  {entry.kind === 'call' ? 'API' : 'SSE'}
                </span>
              </td>
              <td className={styles.colApp}>{entry.appId}</td>
              <td className={styles.colName} title={entry.name}>
                {entry.name}
              </td>
              <td className={styles.colTime}>{formatTime(entry.wallTime)}</td>
              <td className={styles.colDuration}>{formatDuration(entry.durationMs)}</td>
              <td className={styles.colSize}>{sizeLabel(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Map an entry to one of: pending | ok | error | live | closed. */
function statusKey(entry: NetLogEntry): 'pending' | 'ok' | 'error' | 'live' | 'closed' {
  if (entry.kind === 'call') {
    return entry.status === 'pending' ? 'pending' : entry.status === 'success' ? 'ok' : 'error';
  }
  switch (entry.phase) {
    case 'connecting':
    case 'subscribed':
      return 'pending';
    case 'open':
      return 'live';
    case 'error':
      return 'error';
    case 'closed':
      return 'closed';
    case 'ended':
      return 'ok';
  }
}

function sizeLabel(entry: NetLogEntry): string {
  if (entry.kind === 'call') {
    return entry.resultBytes !== undefined ? formatBytes(entry.resultBytes) : '—';
  }
  return `${entry.chunkCount} · ${formatBytes(entry.byteCount)}`;
}
