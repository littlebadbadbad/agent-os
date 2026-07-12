/**
 * extensions/plan/ui/PlanCompactCard.tsx — Compact tool card for plan tools
 *
 * Renders a minimal inline chip showing the plan tool name and a brief summary.
 * Used in compact chat mode where space is limited.
 *
 * Result access is type-safe via `in` narrowing — zero `as` casts.
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@agent-type';
import type { PlanToolResult } from '../agent/types';
import styles from './styles.module.scss';

// ── Per-tool label/icon config ────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string }> = {
  plan_write:      { icon: '📝', label: 'Plan' },
  plan_checkpoint: { icon: '⏸', label: 'Checkpoint' },
  plan_enter:      { icon: '🎯', label: 'Plan Mode' },
  plan_exit:       { icon: '✅', label: 'Exit Plan' },
  plan_verify:     { icon: '🔍', label: 'Verify' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function planStatusBadge(status: string): string {
  if (status === 'approved') return '✓';
  if (status === 'rejected') return '✗';
  if (status === 'cancelled') return '⊘';
  if (status === 'changes_requested') return '↩';
  if (status === 'plan_mode_entered') return '⚡';
  if (status === 'no_plan') return '∅';
  return '';
}

// ── Main compact card ─────────────────────────────────────────────────────────

export function PlanCompactCard({ info }: { info: ToolCallInfo<PlanToolResult> }): ReactElement {
  const { name, result } = info;
  const meta = TOOL_META[name] ?? { icon: '📋', label: name };

  const badge = result && 'status' in result
    ? planStatusBadge(result.status)
    : '';

  return (
    <span className={styles['tc-compact']}>
      <span className={styles['tc-compact-icon']}>{meta.icon}</span>
      <span className={styles['tc-compact-label']}>{meta.label}</span>
      {badge && <span className={styles['tc-compact-badge']}>{badge}</span>}
    </span>
  );
}
