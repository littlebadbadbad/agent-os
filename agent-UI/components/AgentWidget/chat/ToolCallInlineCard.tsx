import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ToolCallInfo, CompactToolCardDescriptor } from '@agent-type';
import type { ToolCallStatus } from '../types';
import { getToolMeta, getCompactSummary, formatResult } from './toolCards/shared';
import { AttachmentList } from './AttachmentList';
import styles from '../AgentWidget.module.scss';

const RESULT_PREVIEW_LINES = 6;

interface ToolCallInlineCardProps {
  readonly info: ToolCallInfo;
  readonly onOpen: () => void;
  /** Plugin-provided descriptor; overrides icon/label/summary/status. */
  readonly descriptor?: CompactToolCardDescriptor;
}

function truncateLines(text: string, maxLines: number): { preview: string; more: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { preview: text, more: 0 };
  return { preview: lines.slice(0, maxLines).join('\n'), more: lines.length - maxLines };
}

function statusText(status: ToolCallStatus): string {
  return status === 'running' ? 'running…' : status === 'done' ? '✓ done' : '✕ error';
}

/**
 * A tool call rendered as a single line of log-like text — no card chrome.
 * Details stay collapsed by default: click the line to expand them inline,
 * or use the ↗ affordance to open the full-detail modal.
 */
export function ToolCallInlineCard({ info, onOpen, descriptor }: ToolCallInlineCardProps): ReactElement {
  const meta = getToolMeta(info.name);
  const icon = descriptor?.icon ?? meta.icon;
  const label = descriptor?.label ?? meta.label;
  const summary = descriptor?.summary ?? getCompactSummary(info);
  const status = descriptor?.status ?? info.status;

  const [expanded, setExpanded] = useState(false);
  const isError = status === 'error';

  const argsJson =
    Object.keys(info.arguments).length > 0 ? JSON.stringify(info.arguments, null, 2) : '';
  const resultText = info.error ?? (info.result !== undefined ? formatResult(info.result) : '');
  const { preview, more } = truncateLines(resultText, RESULT_PREVIEW_LINES);

  const hasDetails =
    argsJson !== '' || resultText !== '' || (info.attachments?.length ?? 0) > 0;

  const lineClass = [
    styles['tool-inline'],
    isError ? styles['tool-inline--error'] : '',
    meta.family === 'meta-agent' ? styles['tool-inline--meta'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={lineClass}>
      <div className={styles['tool-inline-line']}>
        <button
          type="button"
          className={styles['tool-inline-main']}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={`${label}${expanded ? ' — collapse' : ' — expand'}`}
        >
          <span className={styles['tool-inline-icon']} aria-hidden="true">{icon}</span>
          <span className={styles['tool-inline-label']}>{label}</span>
          {summary && <span className={styles['tool-inline-summary']}>{summary}</span>}
          <span className={styles['tool-inline-status']}>{statusText(status)}</span>
          {hasDetails && (
            <span className={styles['tool-inline-chevron']} aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
          )}
        </button>
        <button
          type="button"
          className={styles['tool-inline-detail']}
          onClick={onOpen}
          title="Open full details"
          aria-label="Open full details"
        >
          ↗
        </button>
      </div>

      {expanded && (
        <div className={styles['tool-inline-expanded']}>
          {argsJson !== '' && (
            <div className={styles['tool-inline-section']}>
              <span className={styles['tool-inline-section-label']}>args</span>
              <pre className={styles['tool-inline-code']}>{argsJson}</pre>
            </div>
          )}
          {resultText !== '' && (
            <div className={styles['tool-inline-section']}>
              <span className={styles['tool-inline-section-label']}>
                {info.error ? 'error' : 'result'}
              </span>
              <pre className={styles['tool-inline-code']}>{preview}</pre>
              {more > 0 && (
                <span className={styles['tool-inline-more']}>… {more} more lines</span>
              )}
            </div>
          )}
          {info.attachments && info.attachments.length > 0 && (
            <div className={styles['tool-inline-section']}>
              <AttachmentList attachments={info.attachments} />
            </div>
          )}
          <button type="button" className={styles['tool-inline-full']} onClick={onOpen}>
            Open full details ↗
          </button>
        </div>
      )}
    </div>
  );
}
