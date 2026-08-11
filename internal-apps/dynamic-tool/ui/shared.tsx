/**
 * internal-apps/dynamic-tool/ui/shared.tsx — Shared card UI primitives for dynamic-tool iframe
 */

import type { ReactElement, ReactNode, CSSProperties } from 'react';
import type { ToolCallInfo } from '@agent-type';

// ── Safe arg extractors ────────────────────────────────────────────────────────

export function argStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function argNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

export function argObj(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function resObj(result: unknown): Record<string, unknown> | null {
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : null;
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
  family: 'dynamic';
  devCopyData?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="tool-call-card"
      style={{ '--tc-accent': '#4f46e5' } as CSSProperties}
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

// ── Collapsible section ────────────────────────────────────────────────────────

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
    <details className="tc-section" open={defaultOpen}>
      <summary className="tc-section-summary">{label}</summary>
      <div className="tc-section-body">{children}</div>
    </details>
  );
}

// ── Code block ─────────────────────────────────────────────────────────────────

export function CodeBlock({ code, maxLines }: { code: string; maxLines?: number }): ReactElement {
  const lines = code.split('\n');
  const truncated = maxLines != null && lines.length > maxLines;
  const display = truncated ? lines.slice(0, maxLines).join('\n') : code;
  return (
    <div className="tc-code">
      <pre>{display}</pre>
      {truncated && (
        <span className="tc-code-more">
          {'\u2026'} {lines.length - maxLines} more lines
        </span>
      )}
    </div>
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

// ── Build dev-copy data from ToolCallInfo ──────────────────────────────────────

export function buildDevCopyData(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  error?: string,
): string {
  return JSON.stringify({ name, arguments: args, result, error }, null, 2);
}
