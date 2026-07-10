import type { ReactElement, CSSProperties } from 'react';
import type { ToolCallInfo } from '../types';
import type { SlotSession } from '@agent-type';
import { StatusBadge, getToolMeta, getCompactSummary } from './toolCards/shared';
import { slotRegistry } from '../../../slots/registry';
import { SlotRenderer } from '../../../slots/SlotRenderer';
import styles from '../AgentWidget.module.scss';


interface CompactToolCardProps {
  info: ToolCallInfo;
  onOpen: () => void;
  /** Session for shouldRender evaluation in SlotRenderer. */
  readonly session: SlotSession;
}

/**
 * Single-row pill representation of a tool call.
 * Shows icon + label + condensed summary + status badge.
 * Clicking anywhere opens the full detail modal.
 *
 * Plugin override: if a plugin declares a `compactToolCard` slot whose
 * `toolNames` include this tool's name, the slot's sandboxed iframe is
 * rendered instead of the default compact card. The iframe signals
 * "open detail" via a `CompactToolCardIframeMessage` (`type: "openDetail"`),
 * which triggers `onOpen`.
 */
export function CompactToolCard({ info, onOpen, session }: CompactToolCardProps): ReactElement {
  // ── Plugin compactToolCard slot lookup ────────────────────────────────────
  const pluginSlot = slotRegistry
    .getByType('compactToolCard')
    .find((entry) => entry.declaration.toolNames.includes(info.name));

  if (pluginSlot) {
    return (
      <SlotRenderer
        pluginId={pluginSlot.pluginId}
        slotType="compactToolCard"
        slotId={pluginSlot.slotId}
        toolSetSymbol={pluginSlot.toolSetSymbol}
        session={session}
        toolCallInfo={info}
        onOpenDetail={onOpen}
      />
    );
  }

  // ── Default compact card ──────────────────────────────────────────────────
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
