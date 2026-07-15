import { type ReactElement, type CSSProperties, useRef, useEffect, useCallback } from 'react';
import type { ToolCallInfo, CompactToolCardDescriptor } from '@agent-type';
import type { SlotSession } from '@agent-type';
import { StatusBadge, getToolMeta, getCompactSummary } from './toolCards/shared';
import { useSlotRegistry } from '../../../plugin/PluginContext';
import styles from '../AgentWidget.module.scss';


interface CompactToolCardProps {
  readonly info: ToolCallInfo;
  readonly onOpen: () => void;
  /** Session (kept for signature compatibility with ToolCallCard). */
  readonly session: SlotSession;
}

/**
 * Single-row pill representation of a tool call.
 * Shows icon + label + condensed summary + status badge.
 * Clicking anywhere opens the full detail modal.
 *
 * Plugin override: if a plugin declares a `compactToolCard` slot whose
 * `toolNames` include this tool's name, the descriptor-driven inline
 * card is rendered instead of the default. The slot's `getDescriptor`
 * factory provides structured data; the optional `render` function
 * allows full DOM control in embedded same-process mode.
 */
export function CompactToolCard({ info, onOpen }: CompactToolCardProps): ReactElement {
  const renderRef = useRef<HTMLDivElement>(null);

  const { getByType } = useSlotRegistry();

  // ── Plugin compactToolCard slot lookup ────────────────────────────────────
  const pluginSlot = getByType('compactToolCard')
    .find((entry) => entry.declaration.toolNames.includes(info.name));

  // ── Imperative render (embedded same-process) ─────────────────────────────
  useEffect(() => {
    if (!pluginSlot?.declaration.render) return;
    const el = renderRef.current;
    if (!el) return;
    pluginSlot.declaration.render(el, info);
  }, [pluginSlot, info]);

  const handleOpen = useCallback(() => { onOpen(); }, [onOpen]);

  // ── Plugin descriptor-driven card ─────────────────────────────────────────
  if (pluginSlot) {
    if (pluginSlot.declaration.render) {
      return <div ref={renderRef} />;
    }

    const desc: CompactToolCardDescriptor = pluginSlot.declaration.getDescriptor(info);
    return (
      <button
        type="button"
        className={styles['tool-call-compact']}
        onClick={handleOpen}
        title={`${desc.label} — ${desc.summary}`}
      >
        <span className={styles['tool-call-compact-icon']} aria-hidden="true">
          {desc.icon}
        </span>
        <span className={styles['tool-call-compact-label']}>{desc.label}</span>
        <span className={styles['tool-call-compact-summary']}>{desc.summary}</span>
        <StatusBadge status={desc.status} />
      </button>
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
      onClick={handleOpen}
      title={`${meta.label}${summary ? ` — ${summary}` : ''}`}
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
