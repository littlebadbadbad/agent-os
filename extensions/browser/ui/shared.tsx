/**
 * extensions/browser/ui/shared.tsx
 *
 * Shared tool-card helpers for the browser plugin's UI.
 *
 * Copied from agent-UI/components/AgentWidget/chat/toolCards/shared.tsx
 * and made self-contained — imports types from @agent-type and styles
 * from the local styles.module.scss.
 *
 * This file lives INSIDE the browser plugin, so 'browser' family is
 * kept here (R7 only applies to agent-UI/).
 */

import type { ReactElement, ReactNode, CSSProperties } from 'react';
import type { ToolCallStatus, ToolCallInfo } from '@agent-type';
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

// ── Safe arg extractors (args are Record<string, unknown> at runtime) ─────────

export function argStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function argNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

export function argBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function argArr(args: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = args[key];
  return Array.isArray(v) ? v : undefined;
}

export function argObj(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
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

// ── Family accent colours ─────────────────────────────────────────────────────

export type CardFamily = 'browser';

const ACCENT: Record<CardFamily, string> = {
  browser: '#0ea5e9', // sky blue
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

/** Outer card wrapper — sets the left-border accent colour per family. */
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

/** Standard card header row. */
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

/** Small inline badge — coloured chip for paths, types, runtime, etc. */
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

/** Collapsible section with a labelled toggle button. */
export function CollapsibleSection({
  label,
  defaultOpen,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <details className={styles['tc-section']} open={defaultOpen}>
      <summary className={styles['tc-section-summary']}>{label}</summary>
      <div className={styles['tc-section-body']}>{children}</div>
    </details>
  );
}

/** Monospace code block (non-terminal). */
export function CodeBlock({ code, maxLines }: { code: string; maxLines?: number }): ReactElement {
  const lines = code.split('\n');
  const truncated = maxLines != null && lines.length > maxLines;
  const display = truncated ? lines.slice(0, maxLines).join('\n') : code;
  return (
    <div className={styles['tc-code']}>
      <pre>{display}</pre>
      {truncated && (
        <span className={styles['tc-code-more']}>
          … {lines.length - maxLines!} more lines
        </span>
      )}
    </div>
  );
}

/** Dark terminal output block — strips basic ANSI escape sequences. */
export function TerminalBlock({ output }: { output: string }): ReactElement {
  // Strip ANSI colour/escape codes for the compact card view.
  // eslint-disable-next-line no-control-regex
  const clean = output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  return (
    <div className={styles['tc-terminal-block']}>
      <pre>{clean}</pre>
    </div>
  );
}

/** Inline `label: value` info row. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className={styles['tc-info-row']}>
      <span className={styles['tc-info-label']}>{label}</span>
      <span className={styles['tc-info-value']}>{value}</span>
    </div>
  );
}

/** Error result block. */
export function ErrorResult({ error }: { error: string }): ReactElement {
  return (
    <div className={`${styles['tool-result']} ${styles['tool-result--error']}`}>
      <pre>{error}</pre>
    </div>
  );
}

/** Generic fallback result block. */
export function PlainResult({ result }: { result: unknown }): ReactElement {
  return (
    <div className={styles['tool-result']}>
      <pre>{formatResult(result)}</pre>
    </div>
  );
}
