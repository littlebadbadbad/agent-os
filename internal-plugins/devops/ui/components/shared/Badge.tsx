import React from 'react';
import styles from './Badge.module.scss';

export type BadgeVariant =
  | 'default'
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'orange'
  | 'purple'
  | 'muted';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
}

export function Badge({ label, variant = 'default', dot = false }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {dot && <span className={styles.dot} />}
      {label}
    </span>
  );
}

// ── Semantic helpers ──────────────────────────────────────────────────────────

export function workItemStateBadge(state: string): React.ReactElement {
  const lower = state.toLowerCase();
  let variant: BadgeVariant = 'muted';
  if (/active|in.?progress|approved|committed|doing/.test(lower)) variant = 'blue';
  else if (/resolved/.test(lower)) variant = 'purple';
  else if (/closed|done|completed|finished/.test(lower)) variant = 'green';
  else if (/removed|cancelled|canceled/.test(lower)) variant = 'red';
  return <Badge label={state} variant={variant} dot />;
}

export function buildResultBadge(
  status: string,
  result?: string,
): React.ReactElement {
  if (status === 'inProgress' || status === 'cancelling')
    return <Badge label="进行中" variant="blue" dot />;
  if (status === 'notStarted') return <Badge label="未开始" variant="muted" />;
  if (!result) return <Badge label={status} variant="muted" />;
  if (result === 'succeeded') return <Badge label="成功" variant="green" dot />;
  if (result === 'failed') return <Badge label="失败" variant="red" dot />;
  if (result === 'partiallySucceeded') return <Badge label="部分成功" variant="yellow" dot />;
  if (result === 'canceled') return <Badge label="已取消" variant="muted" />;
  return <Badge label={result} variant="muted" />;
}

export function prStatusBadge(status: string): React.ReactElement {
  if (status === 'active') return <Badge label="活跃" variant="blue" dot />;
  if (status === 'completed') return <Badge label="已完成" variant="green" dot />;
  if (status === 'abandoned') return <Badge label="已放弃" variant="muted" />;
  return <Badge label={status} variant="default" />;
}

export function testOutcomeBadge(outcome: string): React.ReactElement {
  if (outcome === 'Passed') return <Badge label="通过" variant="green" dot />;
  if (outcome === 'Failed') return <Badge label="失败" variant="red" dot />;
  if (outcome === 'Blocked') return <Badge label="阻塞" variant="orange" dot />;
  if (outcome === 'NotExecuted') return <Badge label="未执行" variant="muted" />;
  return <Badge label={outcome} variant="muted" />;
}
