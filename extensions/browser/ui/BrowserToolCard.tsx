import type { ReactElement } from 'react';
import type { ToolCallInfo, DataAttachment } from '@agent-type';
import {
  CardShell, CardHeader, Chip, InfoRow, TerminalBlock,
  ErrorResult, PlainResult, argStr, argBool, argObj, resObj, resStr,
} from './shared';
import styles from './styles.module.scss';

// ── Per-operation metadata ────────────────────────────────────────────────────

const BROWSER_OP: Record<string, { icon: string; label: string }> = {
  browser_list:       { icon: '🌐', label: 'List Browsers' },
  browser_launch:     { icon: '🚀', label: 'Launch Browser' },
  browser_close:      { icon: '✕',  label: 'Close Browser' },
  browser_navigate:   { icon: '→',  label: 'Navigate' },
  browser_run:        { icon: '{}', label: 'Run Script' },
  browser_read:       { icon: '≡',  label: 'Read Output' },
  browser_snapshot:   { icon: '🔍', label: 'Snapshot' },
  browser_wait:       { icon: '⏳', label: 'Wait' },
  browser_screenshot: { icon: '📷', label: 'Screenshot' },
  browser_configure:  { icon: '⚙',  label: 'Configure Browser' },
  browser_switch_tab: { icon: '⇥',  label: 'Switch Tab' },
};

function sessionChip(id: string | undefined): ReactElement | undefined {
  return id ? <Chip label={id.slice(0, 8)} color="#0ea5e9" mono /> : undefined;
}

// ── Screenshot preview ────────────────────────────────────────────────────────

function ScreenshotPreview({ info }: { info: ToolCallInfo }): ReactElement | null {
  const att = info.attachments?.[0];
  if (!att || att.source !== 'data' || att.kind !== 'image') return null;
  const { mimeType, data } = att as DataAttachment;
  const ro = resObj(info.result);
  const url   = ro ? resStr(ro['url'])   : null;
  const title = ro ? resStr(ro['title']) : null;
  return (
    <div className={styles['tc-screenshot']}>
      {(url || title) && (
        <div className={styles['tc-screenshot-meta']}>
          {title && <span className={styles['tc-screenshot-title']}>{title}</span>}
          {url   && <span className={styles['tc-screenshot-url']}>{url}</span>}
        </div>
      )}
      <img
        className={styles['tc-screenshot-img']}
        src={`data:${mimeType};base64,${data}`}
        alt={title ?? 'Browser screenshot'}
        loading="lazy"
      />
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function BrowserToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { name, arguments: args, status, result, error } = info;
  const op     = BROWSER_OP[name] ?? { icon: '🌐', label: name };
  const sessId = argStr(args, 'id');

  const body = (): ReactElement | null => {
    switch (name) {
      case 'browser_launch': {
        const label    = argStr(args, 'label');
        const startUrl = argStr(args, 'startUrl');
        const useProxy = argBool(args, 'useProxy');
        const ro = resObj(result);
        const createdId = ro ? resStr(ro['id']) : null;
        return (
          <>
            {label    && <InfoRow label="label"    value={label} />}
            {startUrl && <InfoRow label="url"      value={<code>{startUrl}</code>} />}
            {useProxy != null && (
              <InfoRow label="proxy" value={<Chip label={useProxy ? 'on' : 'off'} color={useProxy ? '#16a34a' : '#6b7280'} />} />
            )}
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : createdId ? <InfoRow label="id" value={<Chip label={createdId.slice(0, 8)} color="#0ea5e9" mono />} />
                : <PlainResult result={result} />
            )}
          </>
        );
      }

      case 'browser_navigate': {
        const url = argStr(args, 'url') ?? '';
        const ro  = resObj(result);
        const finalUrl = ro ? resStr(ro['url']) : null;
        return (
          <>
            <InfoRow label="url" value={<code>{url}</code>} />
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : finalUrl ? <InfoRow label="→" value={<code>{finalUrl}</code>} />
                : null
            )}
          </>
        );
      }

      case 'browser_run': {
        const script = argStr(args, 'script') ?? '';
        const ro     = resObj(result);
        const evalResult = ro ? ro['result'] : undefined;
        return (
          <>
            <div className={styles['tc-terminal-block']}>
              <pre>{script.length > 300 ? script.slice(0, 300) + '…' : script}</pre>
            </div>
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : evalResult !== undefined
                  ? <InfoRow label="result" value={
                      <code>{typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult)}</code>
                    } />
                  : null
            )}
          </>
        );
      }

      case 'browser_read': {
        const ro     = resObj(result);
        const output = ro ? resStr(ro['output']) : resStr(result);
        return (
          <>
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : output ? <TerminalBlock output={output} />
                : <PlainResult result={result} />
            )}
          </>
        );
      }

      case 'browser_snapshot': {
        const ro    = resObj(result);
        const url   = ro ? resStr(ro['url'])   : null;
        const title = ro ? resStr(ro['title']) : null;
        return (
          <>
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : (
                  <>
                    {title && <InfoRow label="title" value={title} />}
                    {url   && <InfoRow label="url"   value={<code>{url}</code>} />}
                  </>
                )
            )}
          </>
        );
      }

      case 'browser_wait': {
        const selector  = argStr(args, 'selector');
        const waitUntil = argStr(args, 'waitUntil');
        return (
          <>
            {selector  && <InfoRow label="selector"   value={<code>{selector}</code>} />}
            {waitUntil && <InfoRow label="wait until" value={<Chip label={waitUntil} color="#0ea5e9" />} />}
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : null
            )}
          </>
        );
      }

      case 'browser_screenshot': {
        return (
          <>
            {status !== 'running' && (
              error ? <ErrorResult error={error} />
                : <ScreenshotPreview info={info} />
            )}
          </>
        );
      }

      case 'browser_configure': {
        const cfg = argObj(args, 'launchConfig');
        const headless = typeof cfg?.['headless'] === 'boolean' ? cfg['headless'] as boolean : undefined;
        return (
          <>
            {headless != null && (
              <InfoRow label="headless" value={<Chip label={headless ? 'yes' : 'no'} color="#0ea5e9" />} />
            )}
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : null
            )}
          </>
        );
      }

      case 'browser_switch_tab': {
        const index = args['index'];
        return (
          <>
            {index != null && <InfoRow label="tab" value={<Chip label={String(index)} color="#0ea5e9" />} />}
            {status !== 'running' && (
              error ? <ErrorResult error={error} /> : null
            )}
          </>
        );
      }

      default:
        if (status !== 'running') {
          return error ? <ErrorResult error={error} /> : <PlainResult result={result} />;
        }
        return null;
    }
  };

  return (
    <CardShell family="browser">
      <CardHeader
        icon={op.icon}
        label={op.label}
        badge={sessId ? sessionChip(sessId) : undefined}
        status={status}
      />
      <div className={styles['tc-body']}>
        {body()}
      </div>
    </CardShell>
  );
}
