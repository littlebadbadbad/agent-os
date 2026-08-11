/**
 * internal-apps/terminal/ui/shared.tsx
 *
 * Shared tool-card helpers for the terminal app's UI.
 * Self-contained — imports types from @agent-type, styles from local SCSS.
 * Pattern matches browser/ui/shared.tsx exactly.
 */

import type { ReactElement, ReactNode, CSSProperties } from 'react';
import type { ToolCallStatus } from '@agent-type';
import styles from './styles.module.scss';

// ── Result formatter ──────────────────────────────────────────────────────────

export function formatResult(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ── Safe arg extractors ───────────────────────────────────────────────────────

export function argStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function argBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function argNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

// Safe extractors for result objects
export function resObj(result: unknown): Record<string, unknown> | null {
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : null;
}

export function resStr(result: unknown): string | null {
  return typeof result === 'string' ? result : null;
}

// ── Card family ───────────────────────────────────────────────────────────────

export type CardFamily = 'terminal';

const ACCENT: Record<CardFamily, string> = {
  terminal: '#06b6d4', // cyan — matches terminal theme
};

// ── Shared sub-components ─────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: ToolCallStatus }): ReactElement {
  const label =
    status === 'running' ? 'running…' : status === 'done' ? '✓ done' : '✕ error';
  return (
    <span className={`${styles['tool-status']} ${styles[`tool-status--${status}`]}`}>
      {label}
    </span>
  );
}

export function CardShell({
  family,
  children,
}: {
  family: CardFamily;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={styles['tool-call']}
      style={{ '--tc-accent': ACCENT[family] } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon,
  label,
  badge,
  status,
}: {
  icon: string;
  label: string;
  badge?: ReactNode;
  status: ToolCallStatus;
}): ReactElement {
  return (
    <div className={styles['tool-header']}>
      <span className={styles['tool-icon']}>{icon}</span>
      <span className={styles['tool-name']}>{label}</span>
      {badge}
      <StatusBadge status={status} />
    </div>
  );
}

export function Chip({
  label,
  color,
  mono,
}: {
  label: string;
  color?: string;
  mono?: boolean;
}): ReactElement {
  return (
    <span
      className={styles['tc-chip']}
      style={color ? ({ '--chip-color': color } as CSSProperties) : undefined}
      data-mono={mono ? '' : undefined}
    >
      {label}
    </span>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className={styles['tc-info-row']}>
      <span className={styles['tc-info-label']}>{label}</span>
      <span className={styles['tc-info-value']}>{value}</span>
    </div>
  );
}

export function ErrorResult({ error }: { error: string }): ReactElement {
  return (
    <div className={`${styles['tool-result']} ${styles['tool-result--error']}`}>
      <pre>{error}</pre>
    </div>
  );
}

export function PlainResult({ result }: { result: unknown }): ReactElement {
  return (
    <div className={styles['tool-result']}>
      <pre>{formatResult(result)}</pre>
    </div>
  );
}

/** Dark terminal output block. */
export function TerminalBlock({ output }: { output: string }): ReactElement {
  // Strip basic ANSI escape sequences for the card view.
  const clean = output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  return (
    <div className={styles['tc-terminal-block']}>
      <pre>{clean}</pre>
    </div>
  );
}
