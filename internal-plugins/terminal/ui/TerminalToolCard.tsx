/**
 * internal-plugins/terminal/ui/TerminalToolCard.tsx
 *
 * Renders tool call cards for terminal operations.
 * Self-contained — uses local shared.tsx and @agent-type only.
 */

import type { ReactElement } from 'react';
import type { ToolCallInfo } from '@agent-type';
import {
  CardShell, CardHeader, Chip, InfoRow, TerminalBlock,
  ErrorResult, PlainResult, argStr, argBool, resObj, resStr,
} from './shared';

// ── Per-operation metadata ────────────────────────────────────────────────────

const TERMINAL_OP: Record<string, { icon: string; label: string }> = {
  terminal_list:   { icon: '>_', label: 'List Terminals' },
  terminal_create: { icon: '>_', label: 'Create Terminal' },
  terminal_read:   { icon: '≡',  label: 'Read Output' },
  terminal_send:   { icon: '$',  label: 'Send Command' },
  terminal_remove: { icon: '✕',  label: 'Remove Terminal' },
  terminal_wait:   { icon: '⏳', label: 'Wait for Output' },
  terminal_sleep:  { icon: '⏱',  label: 'Sleep' },
};

function terminalIdChip(id: string | undefined): ReactElement | undefined {
  return id ? <Chip label={id} color="#374151" mono /> : undefined;
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function TerminalToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op = TERMINAL_OP[name] ?? { icon: '>_', label: name };
  const termId = argStr(args, 'id');

  const body = (): ReactElement | null => {
    switch (name) {
      case 'terminal_send': {
        const text = argStr(args, 'text') ?? '';
        const raw  = argBool(args, 'raw');
        return (
          <>
            {raw && <InfoRow label="mode" value={<Chip label="raw" color="#374151" />} />}
            <div className="tc-cmd-line">
              <span className="tc-cmd-prompt">$</span>
              <span className="tc-cmd-text">{text}</span>
            </div>
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : null
            )}
          </>
        );
      }

      case 'terminal_read':
      case 'terminal_wait': {
        const ro = resObj(result);
        const output = ro ? resStr(ro['output']) : resStr(result);
        const timedOut = ro ? !!ro['timedOut'] : false;
        return (
          <>
            {timedOut && <InfoRow label="status" value={<Chip label="timed out" color="#b45309" />} />}
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : output ? <TerminalBlock output={output} />
                : <PlainResult result={result} />
            )}
          </>
        );
      }

      case 'terminal_create': {
        const shell = argStr(args, 'shell');
        const cwd   = argStr(args, 'cwd');
        const label = argStr(args, 'label');
        const ro = resObj(result);
        const createdId = ro ? resStr(ro['id']) : null;
        return (
          <>
            {shell && <InfoRow label="shell" value={<code>{shell}</code>} />}
            {cwd   && <InfoRow label="cwd"   value={<code>{cwd}</code>} />}
            {label && <InfoRow label="label" value={label} />}
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : createdId ? <InfoRow label="id" value={<code>{createdId}</code>} />
                : <PlainResult result={result} />
            )}
          </>
        );
      }

      case 'terminal_remove': {
        const ro = resObj(result);
        const removed = ro ? resStr(ro['removed']) : null;
        return (
          <>
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : <PlainResult result={result} />
            )}
          </>
        );
      }

      default:
        return status !== 'running' ? (
          error ? <ErrorResult error={error} /> : <PlainResult result={result} />
        ) : null;
    }
  };

  return (
    <CardShell family="terminal">
      <CardHeader icon={op.icon} label={op.label} badge={terminalIdChip(termId)} status={status} />
      {body()}
    </CardShell>
  );
}
