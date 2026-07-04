import type { ReactElement, CSSProperties } from 'react';
import type { ToolCallInfo } from '../types';
import { StatusBadge, getToolMeta, getCompactSummary } from './toolCards/shared';
import styles from '../AgentWidget.module.scss';

interface CompactToolCardProps {
  info: ToolCallInfo;
  onOpen: () => void;
}

/**
 * Single-row pill representation of a tool call.
 * Shows icon + label + condensed summary + status badge.
 * Clicking anywhere opens the full detail modal.
 */
export function CompactToolCard({ info, onOpen }: CompactToolCardProps): ReactElement {
  const meta = getToolMeta(info.name);
  const summary = getCompactSummary(info);

  return (
    <button
      type="button"
      className={styles['tool-call-compact']}
      style={{ '--tc-accent': meta.accent } as CSSProperties}
      onClick={onOpen}
      title={`${meta.label}${summary ? ` — ${summary}` : ''} — click to view details`}
    >
      <span className={styles['tool-call-compact-icon']} aria-hidden="true">
        {meta.icon}
      </span>
      <span className={styles['tool-call-compact-label']}>{meta.label}</span>
      {summary && (
        <span className={styles['tool-call-compact-summary']}>{summary}</span>
      )}
      <StatusBadge status={info.status} />
    </button>
  );
}
