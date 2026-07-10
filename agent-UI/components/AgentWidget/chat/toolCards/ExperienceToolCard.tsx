import type { ReactElement } from 'react';
import type { ToolCallInfo } from '../../types';
import {
  CardShell, CardHeader, ErrorResult, PlainResult,
  argStr, argNum, argArr, resObj,
} from './shared';
import styles from '../../AgentWidget.module.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

function TagChips({ tags }: { tags: readonly string[] }): ReactElement {
  return (
    <div className={styles['exp-item-tags']}>
      {tags.map((t) => (
        <span key={t} className={`${styles['exp-tag']} ${styles['exp-tag--static']}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

function TruncatedRow({ label, value, max = 120 }: { label: string; value: string; max?: number }): ReactElement {
  return (
    <div className={styles['tc-info-row']}>
      <span className={styles['tc-info-label']}>{label}</span>
      <span className={styles['tc-info-value']}>{value.length > max ? `${value.slice(0, max)}…` : value}</span>
    </div>
  );
}

// ── Per-operation cards ───────────────────────────────────────────────────────

function ExperienceAddCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const trigger    = argStr(args, 'trigger') ?? '';
  const insight    = argStr(args, 'insight') ?? '';
  const evidence   = argStr(args, 'evidence');
  const confidence = argNum(args, 'confidence');
  const rawTags    = argArr(args, 'tags');
  const tags       = rawTags?.filter((t): t is string => typeof t === 'string') ?? [];

  const res     = resObj(result);
  const addedId = typeof res?.['id'] === 'number' ? String(res['id']) : typeof res?.['id'] === 'string' ? res['id'] : undefined;
  const total   = typeof res?.['total'] === 'number' ? res['total'] : undefined;

  const badge = total !== undefined ? (
    <span className={styles['tc-todo-summary']}>{total} total</span>
  ) : undefined;

  return (
    <CardShell family="dynamic">
      <CardHeader icon="💡" label="experience_add" status={status} badge={badge} />
      {(trigger || insight) && (
        <div className={styles['tc-body']}>
          {trigger   && <TruncatedRow label="Trigger"    value={trigger} />}
          {insight   && <TruncatedRow label="Insight"    value={insight} />}
          {evidence  && <TruncatedRow label="Evidence"   value={evidence} />}
          {confidence !== undefined && (
            <div className={styles['tc-info-row']}>
              <span className={styles['tc-info-label']}>Confidence</span>
              <span className={styles['tc-info-value']}>{confidence.toFixed(2)}</span>
            </div>
          )}
          {tags.length > 0 && (
            <div className={styles['tc-info-row']}>
              <span className={styles['tc-info-label']}>Tags</span>
              <TagChips tags={tags} />
            </div>
          )}
          {status !== 'running' && addedId && (
            <div className={styles['tc-info-row']}>
              <span className={styles['tc-info-label']}>ID</span>
              <span className={styles['tc-info-value']}>
                <code>{addedId.slice(0, 8)}…</code>
              </span>
            </div>
          )}
        </div>
      )}
      {status !== 'running' && (error ? <ErrorResult error={error} /> : !(trigger || insight) ? <PlainResult result={result} /> : null)}
    </CardShell>
  );
}

function ExperienceUpdateCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const id         = argStr(args, 'id') ?? '';
  const trigger    = argStr(args, 'trigger');
  const insight    = argStr(args, 'insight');
  const evidence   = argStr(args, 'evidence');
  const confidence = argNum(args, 'confidence');
  const rawTags    = argArr(args, 'tags');
  const tags       = rawTags?.filter((t): t is string => typeof t === 'string');

  const changed: string[] = [
    trigger    !== undefined ? 'trigger'    : null,
    insight    !== undefined ? 'insight'    : null,
    evidence   !== undefined ? 'evidence'   : null,
    confidence !== undefined ? 'confidence' : null,
    tags       !== undefined ? 'tags'       : null,
  ].filter((x): x is string => x !== null);

  return (
    <CardShell family="dynamic">
      <CardHeader icon="✏️" label="experience_update" status={status} />
      <div className={styles['tc-body']}>
        <div className={styles['tc-info-row']}>
          <span className={styles['tc-info-label']}>ID</span>
          <span className={styles['tc-info-value']}><code>{id.slice(0, 8)}…</code></span>
        </div>
        {changed.length > 0 && (
          <div className={styles['tc-info-row']}>
            <span className={styles['tc-info-label']}>Updated</span>
            <span className={styles['tc-info-value']}>{changed.join(', ')}</span>
          </div>
        )}
        {trigger  !== undefined && <TruncatedRow label="Trigger" value={trigger} max={100} />}
        {insight  !== undefined && <TruncatedRow label="Insight" value={insight} max={100} />}
        {evidence !== undefined && <TruncatedRow label="Evidence" value={evidence} max={100} />}
        {confidence !== undefined && (
          <div className={styles['tc-info-row']}>
            <span className={styles['tc-info-label']}>Confidence</span>
            <span className={styles['tc-info-value']}>{confidence.toFixed(2)}</span>
          </div>
        )}
        {tags !== undefined && tags.length > 0 && (
          <div className={styles['tc-info-row']}>
            <span className={styles['tc-info-label']}>Tags</span>
            <TagChips tags={tags} />
          </div>
        )}
      </div>
      {status !== 'running' && (error ? <ErrorResult error={error} /> : null)}
    </CardShell>
  );
}

function ExperienceDeleteCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const id = argStr(args, 'id') ?? '';
  const res = resObj(result);
  const remaining = typeof res?.['remaining'] === 'number' ? res['remaining'] : undefined;

  const badge = remaining !== undefined ? (
    <span className={styles['tc-todo-summary']}>{remaining} remaining</span>
  ) : undefined;

  return (
    <CardShell family="dynamic">
      <CardHeader icon="🗑" label="experience_delete" status={status} badge={badge} />
      <div className={styles['tc-body']}>
        <div className={styles['tc-info-row']}>
          <span className={styles['tc-info-label']}>ID</span>
          <span className={styles['tc-info-value']}><code>{id.slice(0, 8)}…</code></span>
        </div>
      </div>
      {status !== 'running' && (error ? <ErrorResult error={error} /> : null)}
    </CardShell>
  );
}

function ExperienceListCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const tag = argStr(args, 'tag');
  const res = resObj(result);
  const total = typeof res?.['total'] === 'number' ? res['total'] : undefined;

  const badge = total !== undefined ? (
    <span className={styles['tc-todo-summary']}>{total} {tag ? `tagged "${tag}"` : 'entries'}</span>
  ) : undefined;

  return (
    <CardShell family="dynamic">
      <CardHeader icon="📋" label="experience_list" status={status} badge={badge} />
      {tag && (
        <div className={styles['tc-body']}>
          <div className={styles['tc-info-row']}>
            <span className={styles['tc-info-label']}>Filter</span>
            <TagChips tags={[tag]} />
          </div>
        </div>
      )}
      {status !== 'running' && (error ? <ErrorResult error={error} /> : null)}
    </CardShell>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function ExperienceToolCard({ info }: { info: ToolCallInfo }): ReactElement {
  switch (info.name) {
    case 'experience_add':    return <ExperienceAddCard info={info} />;
    case 'experience_update': return <ExperienceUpdateCard info={info} />;
    case 'experience_delete': return <ExperienceDeleteCard info={info} />;
    case 'experience_list':   return <ExperienceListCard info={info} />;
    default:                  return <PlainResult result={info.result} />;
  }
}
