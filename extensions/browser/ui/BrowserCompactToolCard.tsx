/**
 * extensions/browser/ui/BrowserCompactToolCard.tsx
 *
 * Ultra-minimal single-line compact card for browser tool calls.
 *
 * Design goal: one line of text, zero borders, zero chrome.
 * The entire row is clickable — clicking sends `openDetail` to the
 * host so the full BrowserToolCard renders in the detail modal.
 *
 * Communication:
 *   All messages to the host are sent via `host.sendSlotMessage()`.
 *   No direct `window.parent.postMessage()` calls.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import type { ToolCallInfo, UiPluginHost, SlotIframeMessage } from '@agent-type';
import { argStr, resObj, resStr } from './shared';
import styles from './styles.module.scss';

// ── Per-operation short labels ────────────────────────────────────────────────

const SHORT_LABEL: Record<string, string> = {
  browser_list:         'List',
  browser_launch:       'Launch',
  browser_close:        'Close',
  browser_navigate:     'Navigate',
  browser_run:          'Run',
  browser_read:         'Read',
  browser_snapshot:     'Snapshot',
  browser_wait:         'Wait',
  browser_screenshot:   'Screenshot',
  browser_configure:    'Configure',
  browser_switch_tab:   'Switch Tab',
  browser_network:      'Network',
  browser_clear_network:'Clear Net',
};

// ── One-line summary extractor ────────────────────────────────────────────────

function oneLineSummary(info: ToolCallInfo): string {
  const { name, arguments: args, status, result, error } = info;

  // Error takes priority when present.
  if (status === 'error' && error) {
    const short = error.split('\n')[0];
    return short.length > 60 ? `${short.slice(0, 60)}…` : short;
  }

  // Per-operation concise summary.
  switch (name) {
    case 'browser_launch': {
      const label = argStr(args, 'label');
      const startUrl = argStr(args, 'startUrl');
      const ro = resObj(result);
      const id = ro ? resStr(ro['id']) : null;
      if (status === 'running') return label ? `launching "${label}"…` : 'launching…';
      return [label ?? startUrl, id ? `#${id.slice(0, 8)}` : null].filter(Boolean).join(' ');
    }
    case 'browser_navigate': {
      const url = argStr(args, 'url') ?? '';
      if (status === 'running') return `${url} …`;
      const ro = resObj(result);
      const title = ro ? resStr(ro['title']) : null;
      return title ? `${title} — ${url}` : url;
    }
    case 'browser_run': {
      const script = argStr(args, 'script') ?? '';
      const short = script.split('\n')[0].trim();
      return short.length > 50 ? `${short.slice(0, 50)}…` : short || 'run script';
    }
    case 'browser_snapshot': {
      if (status === 'running') return 'capturing snapshot…';
      const ro = resObj(result);
      const title = ro ? resStr(ro['title']) : null;
      return title ?? 'snapshot done';
    }
    case 'browser_screenshot': {
      return status === 'running' ? 'capturing screenshot…' : 'screenshot captured';
    }
    case 'browser_wait': {
      const selector = argStr(args, 'selector');
      const waitUntil = argStr(args, 'waitUntil');
      return [selector, waitUntil].filter(Boolean).join(' · ');
    }
    case 'browser_switch_tab': {
      const idx = args['index'];
      return idx != null ? `tab #${idx}` : 'switch tab';
    }
    case 'browser_configure': {
      return 'launch config';
    }
    case 'browser_read': {
      if (status === 'running') return 'reading output…';
      const ro = resObj(result);
      const output = ro ? resStr(ro['output']) : resStr(result);
      if (!output) return 'read output';
      const firstLine = output.split('\n')[0];
      return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    }
    default:
      return '';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BrowserCompactToolCard({
  info,
  host,
}: {
  info: ToolCallInfo;
  host: UiPluginHost;
}): ReactElement {
  const { name, status } = info;
  const label = SHORT_LABEL[name] ?? name;
  const summary = oneLineSummary(info);

  const cardRef = useRef<HTMLDivElement>(null);

  // Report the card's actual rendered size back to the host via
  // host.sendSlotMessage() so the iframe wrapper can be resized to
  // fit the content exactly.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const report = () => {
      const rect = el.getBoundingClientRect();
      const msg: SlotIframeMessage = {
        version: 1,
        type: 'resize',
        payload: {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        },
      };
      host.sendSlotMessage(msg);
    };

    requestAnimationFrame(report);

    const obs = new ResizeObserver(() => report());
    obs.observe(el);
    return () => obs.disconnect();
  }, [info, host]);

  const handleClick = () => {
    const msg: SlotIframeMessage = {
      version: 1,
      type: 'openDetail',
    };
    host.sendSlotMessage(msg);
  };

  const statusMark =
    status === 'running' ? '…' : status === 'done' ? '' : ' ✕';

  return (
    <div
      ref={cardRef}
      className={styles['compact-tool-card']}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      title="Click to view details"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <span className={styles['compact-tool-card__label']}>{label}</span>
      {summary && <span className={styles['compact-tool-card__summary']}>{summary}</span>}
      {statusMark && <span className={styles['compact-tool-card__status']}>{statusMark}</span>}
    </div>
  );
}
