/**
 * extensions/cron/ui/CronPanel.tsx — Cron job list panel
 *
 * Renders the scheduled job list inside the iframe panel slot.
 * Each job card shows status, label, expression, next fire time,
 * and action buttons (pause/resume/delete).
 */

import { useState, useCallback, type ReactElement } from "react";
import type { CronJob } from "../agent/types";
import styles from "./styles.module.scss";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadge(status: CronJob["status"]): string {
  if (status === "active") return "\u25B6";
  if (status === "paused") return "\u23F8";
  if (status === "completed") return "\u2713";
  return status;
}

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
    styles["action-btn"],
    danger ? styles["action-btn--danger"] : undefined,
  ].filter(Boolean).join(" ");

  return (
    <button className={cls} title={title} disabled={busy} onClick={handleClick}>
      {busy ? "\u2026" : label}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface CronPanelProps {
  jobs: readonly CronJob[];
  onPause?: (id: string) => Promise<void>;
  onResume?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function CronPanel({ jobs, onPause, onResume, onDelete }: CronPanelProps): ReactElement {
  if (jobs.length === 0) {
    return (
      <div className={styles["empty"]}>
        No scheduled tasks. Ask the agent to use <code>cron_create</code> to add one.
      </div>
    );
  }

  return (
    <div className={styles["panel"]}>
      {jobs.map((job) => (
        <div
          key={job.id}
          className={[styles["job"], styles["job--" + job.status]].join(" ")}
        >
          <div className={styles["job-header"]}>
            <span className={styles["job-status"]} title={job.status}>
              {statusBadge(job.status)}
            </span>
            <span className={styles["job-label"]}>{job.label}</span>
            <code className={styles["job-expr"]}>{job.cronExpr}</code>
            {job.recurring ? null : (
              <span className={styles["job-tag"]}>one-shot</span>
            )}
          </div>
          <div className={styles["job-meta"]}>
            <span title="Next fire time">
              Next: <strong>{formatDate(job.nextFireAt)}</strong>
            </span>
            {job.fireCount > 0 && (
              <span title="Last fire time">
                {" \u00B7 "}Last: {formatDate(job.lastFiredAt)} ({job.fireCount}\u00D7)
              </span>
            )}
          </div>
          <div className={styles["job-prompt"]} title="Prompt injected when fired">
            {job.prompt}
          </div>
          {job.status !== "completed" && (
            <div className={styles["job-actions"]}>
              {job.status === "active" && onPause && (
                <ActionButton
                  label="Pause"
                  title="Pause this job"
                  onClick={() => onPause(job.id)}
                />
              )}
              {job.status === "paused" && onResume && (
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
