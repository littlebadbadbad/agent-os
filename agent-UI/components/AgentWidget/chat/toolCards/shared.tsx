import type { ReactElement, ReactNode, CSSProperties } from 'react';
import type { ToolCallStatus, ToolCallInfo } from '../../types';
import {
  isFileTool, isAskUserTool,
  isDynamicTool, isSubAgentMetaTool,
} from './identifiers';
import styles from '../../AgentWidget.module.scss';

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

export type CardFamily =
  | 'file' | 'ask'
  | 'dynamic' | 'meta-agent';

const ACCENT: Record<CardFamily, string> = {
  file:          '#d97706',   // amber
  ask:           '#ea580c',   // orange
  dynamic:       '#4f46e5',   // indigo
  'meta-agent':  '#6d28d9',   // purple
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

// ── Tool metadata helpers ──────────────────────────────────────────────────────

/** Per-family display metadata. */
const FAMILY_META: Record<CardFamily, { icon: string; label: string }> = {
  file:          { icon: '📄', label: 'File' },
  ask:           { icon: '💬', label: 'Ask' },
  dynamic:       { icon: '⚡', label: 'Tool' },
  'meta-agent':  { icon: '🤖', label: 'Agent' },
};

/** Per-operation label overrides for file tools. */
const FILE_LABEL: Record<string, string> = {
  read_file:          'Read File',
  write_file:         'Write File',
  str_replace:        'Edit File',
  delete_file:        'Delete File',
  move_file:          'Move File',
  list_dir:           'List Dir',
  search_files:       'Search Files',
  get_workspace_root: 'Workspace Root',
  set_workspace_root: 'Set Root',
};

/** Returns icon, human-readable label, card family, and accent colour for any tool. */
export function getToolMeta(name: string): { icon: string; label: string; family: CardFamily; accent: string } {
  let family: CardFamily;
  let label: string;

  if (isFileTool(name)) {
    family = 'file';
    label = FILE_LABEL[name] ?? name;
  } else if (isAskUserTool(name)) {
    family = 'ask';
    label = 'Ask User';
  } else if (isDynamicTool(name)) {
    family = 'dynamic';
    label = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } else if (isSubAgentMetaTool(name)) {
    family = 'meta-agent';
    label = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } else {
    family = 'file';
    label = name;
  }

  const { icon } = FAMILY_META[family];
  return { icon, label, family, accent: ACCENT[family] };
}

/** Extracts a concise one-line summary from a tool call's arguments.
 *  Returns an empty string when no meaningful summary is available. */
export function getCompactSummary({ name, arguments: args }: ToolCallInfo): string {
  // Path-based tools: shorten to last 2 path segments.
  const path = argStr(args, 'path') ?? argStr(args, 'from') ?? argStr(args, 'file_path');
  if (path) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
  }

  // Generic: use the first non-empty string argument value.
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.trim()) {
      return v.length > 50 ? `${v.slice(0, 50)}…` : v;
    }
  }

  return '';
}
