import { useState, useCallback, type ReactElement } from 'react';
import type { CronJob } from '@agent-sdk';
import styles from '../AgentWidget.module.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusBadge(status: CronJob['status']): string {
  if (status === 'active')    return '▶';
  if (status === 'paused')    return '⏸';
  if (status === 'completed') return '✓';
  return status;
}

// ── Action button ─────────────────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  title: string;
  danger?: boolean;
  onClick: () => Promise<void>;
}

function ActionButton({ label, title, danger, onClick }: ActionButtonProps): ReactElement {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try { await onClick(); } finally { setBusy(false); }
  }, [busy, onClick]);

  const cls = [
    styles['cron-job-action-btn'],
    danger ? styles['cron-job-action-btn--danger'] : undefined,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} title={title} disabled={busy} onClick={handleClick}>
      {busy ? '…' : label}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface CronPanelProps {
  jobs: readonly CronJob[];
  onPause?:  (id: string) => Promise<void>;
  onResume?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function CronPanel({ jobs, onPause, onResume, onDelete }: CronPanelProps): ReactElement {
  if (jobs.length === 0) {
    return (
      <div className={styles['empty']}>
        No scheduled tasks. Use <code>cron_create</code> to add one.
      </div>
    );
  }

  return (
    <div className={styles['cron-panel']}>
      {jobs.map((job) => (
        <div
          key={job.id}
          className={`${styles['cron-job']} ${styles[`cron-job--${job.status}`]}`}
        >
          <div className={styles['cron-job-header']}>
            <span className={styles['cron-job-status']} title={job.status}>
              {statusBadge(job.status)}
            </span>
            <span className={styles['cron-job-label']}>{job.label}</span>
            <code className={styles['cron-job-expr']}>{job.cronExpr}</code>
            {job.recurring ? null : (
              <span className={styles['cron-job-tag']}>one-shot</span>
            )}
          </div>
          <div className={styles['cron-job-meta']}>
            <span title="Next fire time">
              Next: <strong>{formatDate(job.nextFireAt)}</strong>
            </span>
            {job.fireCount > 0 && (
              <span title="Last fire time">
                · Last: {formatDate(job.lastFiredAt)} ({job.fireCount}×)
              </span>
            )}
          </div>
          <div className={styles['cron-job-prompt']} title="Prompt injected when fired">
            {job.prompt}
          </div>
          {job.status !== 'completed' && (
            <div className={styles['cron-job-actions']}>
              {job.status === 'active' && onPause && (
                <ActionButton
                  label="Pause"
                  title="Pause this job"
                  onClick={() => onPause(job.id)}
                />
              )}
              {job.status === 'paused' && onResume && (
                <ActionButton
                  label="Resume"
                  title="Resume this job"
                  onClick={() => onResume(job.id)}
                />
              )}
              {onDelete && (
                <ActionButton
                  label="Delete"
                  title="Permanently delete this job"
                  danger
                  onClick={() => onDelete(job.id)}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
