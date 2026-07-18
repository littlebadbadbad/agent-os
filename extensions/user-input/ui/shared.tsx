/**
 * extensions/user-input/ui/shared.tsx — Shared card UI primitives for user-input iframe
 */

import type { ReactElement, ReactNode, CSSProperties } from 'react';

// ── Arg extractors ─────────────────────────────────────────────────────────────

export function argStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function argArr(args: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = args[key];
  return Array.isArray(v) ? v : undefined;
}

export function resStr(result: unknown): string | null {
  return typeof result === 'string' ? result : null;
}

// ── Dev-mode detection ────────────────────────────────────────────────────────

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

function devCopy(text: string): void {
  if (!IS_DEV) return;
  void navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
}

// ── Status badge ───────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }): ReactElement {
  const label =
    status === 'running' ? 'running\u2026' : status === 'done' ? '\u2713 done' : '\u2715 error';
  return (
    <span className="tool-status" data-status={status}>
      {label}
    </span>
  );
}

// ── Card shell ─────────────────────────────────────────────────────────────────

export function CardShell({
  family,
  devCopyData,
  children,
}: {
  family: 'ask';
  devCopyData?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="tool-call-card"
      style={{ '--tc-accent': '#ea580c' } as CSSProperties}
    >
      {children}
      {IS_DEV && devCopyData && <DevCopyButton data={devCopyData} />}
    </div>
  );
}

function DevCopyButton({ data }: { data: string }): ReactElement {
  return (
    <button
      className="dev-copy-btn"
      type="button"
      title="Copy tool call data (dev mode)"
      onClick={() => devCopy(data)}
    >
      {'\u{1F4CB}'}
    </button>
  );
}

// ── Card header ────────────────────────────────────────────────────────────────

export function CardHeader({
  icon,
  label,
  badge,
  status,
}: {
  icon: string;
  label: string;
  badge?: ReactNode;
  status: string;
}): ReactElement {
  return (
    <div className="tool-header">
      <span className="tool-icon">{icon}</span>
      <span className="tool-name">{label}</span>
      {badge}
      <StatusBadge status={status} />
    </div>
  );
}

// ── Chip ───────────────────────────────────────────────────────────────────────

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
      className="tc-chip"
      style={color ? ({ '--chip-color': color } as CSSProperties) : undefined}
      data-mono={mono ? '' : undefined}
    >
      {label}
    </span>
  );
}

// ── Info row ───────────────────────────────────────────────────────────────────

export function InfoRow({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="tc-info-row">
      <span className="tc-info-label">{label}</span>
      <span className="tc-info-value">{value}</span>
    </div>
  );
}

// ── Error result ───────────────────────────────────────────────────────────────

export function ErrorResult({ error }: { error: string }): ReactElement {
  return (
    <div className="tool-result" data-error>
      <pre>{error}</pre>
    </div>
  );
}

// ── Plain result ───────────────────────────────────────────────────────────────

export function PlainResult({ result }: { result: unknown }): ReactElement {
  return (
    <div className="tool-result">
      <pre>{formatResult(result)}</pre>
    </div>
  );
}

function formatResult(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ── Build dev-copy data ────────────────────────────────────────────────────────

export function buildDevCopyData(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  error?: string,
): string {
  return JSON.stringify({ name, arguments: args, result, error }, null, 2);
}
