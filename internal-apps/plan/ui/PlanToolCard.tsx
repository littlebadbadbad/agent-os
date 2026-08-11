/**
 * internal-apps/plan/ui/PlanToolCard.tsx — Full tool card for plan tools
 *
 * Renders a detailed card for plan_write, plan_checkpoint, plan_enter,
 * plan_exit, and plan_verify tool calls. Shows the plan content preview
 * (first 300 chars) for plan_write, and status/results for the others.
 *
 * Result access is fully type-safe via `in` narrowing on the discriminated
 * {@link PlanToolResult} union — zero `as` casts.
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo, ToolCallStatus } from '@agent-type';
import type { PlanToolResult } from '../agent/types';
import styles from './styles.module.scss';

// ── Per-tool icon map ─────────────────────────────────────────────────────────

const TOOL_ICON: Record<string, string> = {
  plan_write:      '📝',
  plan_checkpoint: '⏸',
  plan_enter:      '🎯',
  plan_exit:       '✅',
  plan_verify:     '🔍',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v : '';
}

function formatResult(result: unknown): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ToolCallStatus }): ReactElement {
  const mod = status === 'running' ? 'tc-status-dot--running'
    : status === 'done' ? 'tc-status-dot--done'
    : 'tc-status-dot--error';
  return <span className={`${styles['tc-status-dot']} ${styles[mod]}`} />;
}

function PlanPreview({ content }: { content: string }): ReactElement | null {
  if (!content) return null;
  const truncated = truncate(content, 300);
  return (
    <div className={styles['tc-plan-preview']}>
      {truncated}
    </div>
  );
}

function ResultBlock({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className={styles['tc-info-row']}>
      <span className={styles['tc-info-label']}>{label}</span>
      <span className={styles['tc-info-value']}>{value}</span>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function PlanToolCard({ info }: { info: ToolCallInfo<PlanToolResult> }): ReactElement {
  const { name, arguments: args, status, result, error } = info;

  const icon = TOOL_ICON[name] ?? '📋';
  const displayName = name.replace('plan_', '').replace(/_/g, ' ');

  // Extract plan content for plan_write
  const planContent = name === 'plan_write' ? getStringArg(args, 'content') : '';

  // ── Type-safe result field extraction via `in` narrowing ──────────────────
  // No `as` casts — the discriminated union is narrowed structurally.

  /** Excludes PlanWriteResult; present on all checkpoint/enter/exit results. */
  const resultStatus = result && 'status' in result ? result.status : '';
  /** Only PlanEnterResult and PlanExitApproved/NoPlan carry a message. */
  const resultMessage = result && 'message' in result ? result.message : '';
  /** Only PlanCheckpointRejected and PlanExitChangesRequested carry feedback. */
  const resultFeedback = result && 'feedback' in result ? result.feedback : '';

  // plan_verify: `'total' in result` narrows to exactly PlanVerifyResult.
  const verify = result && 'total' in result ? result : null;

  return (
    <div className={styles['tc-shell']}>
      {/* Header */}
      <div className={styles['tc-shell-header']}>
        <span className={styles['tc-tool-icon']}>{icon}</span>
        <span className={styles['tc-tool-name']}>{displayName}</span>
        <StatusDot status={status} />
      </div>

      {/* Plan content preview (plan_write) */}
      <PlanPreview content={planContent} />

      <div className={styles['tc-body']}>
        {resultStatus && <ResultBlock label="Status" value={resultStatus} />}
        {resultMessage && <ResultBlock label="Message" value={resultMessage} />}
        {resultFeedback && <ResultBlock label="Feedback" value={truncate(resultFeedback, 120)} />}
        {verify && (
          <ResultBlock
            label="Progress"
            value={`${verify.completed} / ${verify.total} steps verified`}
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className={styles['tc-result-error']}>
          {formatResult(error)}
        </div>
      )}

      {/* Generic result fallback (plan_write: `{ success: true }`) */}
      {result && !resultStatus && !verify && !error && (
        <div className={styles['tc-result']}>
          <pre>{formatResult(result)}</pre>
        </div>
      )}
    </div>
  );
}
