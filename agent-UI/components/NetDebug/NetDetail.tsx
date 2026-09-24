/**
 * NetDetail — right-hand inspector for a single recorded network entry.
 *
 * Shows an overview (type / app / name / timing / status), the request params,
 * and — depending on the entry kind — the response result + error (call) or
 * an expandable chunk feed (stream).
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { NetCallEntry, NetLogEntry, NetStreamChunk, NetStreamEntry } from '../../store/netLog';
import { JsonViewer, safeStringify } from './JsonViewer';
import { TextViewer } from './TextViewer';
import { computeStreamAggregate, fieldValue } from './streamAggregate';
import { formatBytes, formatDuration, formatTime } from './format';
import styles from './NetDetail.module.scss';

interface NetDetailProps {
  readonly entry: NetLogEntry | null;
}

export function NetDetail({ entry }: NetDetailProps): ReactElement {
  if (!entry) {
    return <div className={styles.empty}>选择一条记录查看详情</div>;
  }

  return (
    <div className={styles.detail}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>概览</div>
        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt>类型</dt>
            <dd>{entry.kind === 'call' ? 'call' : 'stream'}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>App</dt>
            <dd>{entry.appId}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>{entry.kind === 'call' ? '方法' : '流'}</dt>
            <dd className={styles.mono}>{entry.name}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>时间</dt>
            <dd className={styles.mono}>{formatTime(entry.wallTime)}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>耗时</dt>
            <dd className={styles.mono}>{formatDuration(entry.durationMs)}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt>状态</dt>
            <dd>{statusLabel(entry)}</dd>
          </div>
          {entry.kind === 'stream' && (
            <div className={styles.metaRow}>
              <dt>数据</dt>
              <dd className={styles.mono}>
                {entry.chunkCount} chunks · {formatBytes(entry.byteCount)}
              </dd>
            </div>
          )}
          {entry.kind === 'call' && entry.resultBytes !== undefined && (
            <div className={styles.metaRow}>
              <dt>响应大小</dt>
              <dd className={styles.mono}>{formatBytes(entry.resultBytes)}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>请求参数</div>
        <JsonViewer key={`p-${entry.id}`} value={entry.params} emptyText="(无参数)" />
      </div>

      {entry.kind === 'call' ? (
        <CallBody entry={entry} />
      ) : (
        <StreamBody entry={entry} />
      )}
    </div>
  );
}

function statusLabel(entry: NetLogEntry): string {
  if (entry.kind === 'call') {
    return entry.status === 'pending'
      ? '⏳ 进行中'
      : entry.status === 'success'
        ? '✓ 成功'
        : '✗ 失败';
  }
  const map: Record<NetStreamEntry['phase'], string> = {
    connecting: '⏳ 连接中',
    subscribed: '⏳ 已订阅',
    open: '● 传输中',
    ended: '✓ 已结束',
    error: '✗ 出错',
    closed: '■ 已关闭',
  };
  return map[entry.phase];
}

function CallBody({ entry }: { readonly entry: NetCallEntry }): ReactElement {
  return (
    <>
      {entry.error && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>错误</div>
          <div className={styles.errorBox}>
            <div className={styles.errorName}>
              {entry.error.name}
              {entry.error.status ? ` · ${entry.error.status}` : ''}
            </div>
            <div>{entry.error.message}</div>
            {entry.error.stack && <pre className={styles.stack}>{entry.error.stack}</pre>}
          </div>
        </div>
      )}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>返回结果</div>
        {entry.status === 'pending' ? (
          <div className={styles.pending}>等待响应…</div>
        ) : (
          <JsonViewer key={`r-${entry.id}`} value={entry.result} emptyText="(无返回值)" />
        )}
      </div>
    </>
  );
}

// ── Stream body ───────────────────────────────────────────────────────────────

const NO_SELECTION: ReadonlySet<number> = new Set();

/** One-line flattened preview of a chunk sample for the collapsed row. */
function chunkPreview(chunk: NetStreamChunk): string {
  if (chunk.sample === undefined) return '(二进制数据)';
  const flat = (
    typeof chunk.sample === 'string' ? chunk.sample : safeStringify(chunk.sample)
  ).replace(/\s+/g, ' ');
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

type StreamTab = 'aggregate' | 'frames';

function StreamBody({ entry }: { readonly entry: NetStreamEntry }): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(NO_SELECTION);
  // Computed per render: the store mutates the aggregate in place, so any
  // memo keyed on its identity would go stale. The pass is tiny (≤ 24 keys).
  const aggView = computeStreamAggregate(entry.aggregate);
  const hasAggregate = aggView.mode !== 'raw';
  const [tab, setTab] = useState<StreamTab>('aggregate');
  const [field, setField] = useState<string | undefined>(aggView.defaultField);

  const toggle = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const activeTab: StreamTab = hasAggregate ? tab : 'frames';

  return (
    <>
      {entry.error && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>错误</div>
          <div className={styles.errorBox}>
            <div className={styles.errorName}>{entry.error.name}</div>
            <div>{entry.error.message}</div>
          </div>
        </div>
      )}
      <div className={styles.section}>
        <div className={styles.streamHead}>
          <div className={styles.tabs} role="tablist">
            {hasAggregate && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'aggregate'}
                className={activeTab === 'aggregate' ? styles.tabActive : styles.tab}
                onClick={() => setTab('aggregate')}
              >
                {aggView.mode === 'plain-string' ? '拼接文本' : '字段拼接'}
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'frames'}
              className={activeTab === 'frames' ? styles.tabActive : styles.tab}
              onClick={() => setTab('frames')}
            >
              数据帧{' '}
              <span className={styles.count}>
                {entry.chunks.length}/{entry.chunkCount}
              </span>
            </button>
          </div>
          {entry.phase === 'open' && <span className={styles.liveDot} title="流传输中" />}
        </div>

        {activeTab === 'aggregate' ? (
          <AggregateBody entry={entry} field={field} fallback={aggView.defaultField ?? ''} onField={setField} />
        ) : entry.chunks.length === 0 ? (
          <div className={styles.pending}>尚无数据</div>
        ) : (
          <ul className={styles.chunkList}>
            {entry.chunks.map((c, i) => (
              <ChunkRow
                key={c.index}
                chunk={c}
                gapMs={i === 0 ? undefined : c.at - entry.chunks[i - 1].at}
                expanded={expanded.has(c.index)}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ── Aggregate view ────────────────────────────────────────────────────────────

interface AggregateBodyProps {
  readonly entry: NetStreamEntry;
  /** Selected JSON field (json-field mode only); may be stale for this entry. */
  readonly field: string | undefined;
  /** Default field used when the selection does not exist here. */
  readonly fallback: string;
  readonly onField: (field: string) => void;
}

function AggregateBody({ entry, field, fallback, onField }: AggregateBodyProps): ReactElement {
  const agg = entry.aggregate;
  const view = computeStreamAggregate(agg);
  const active = field !== undefined && agg.fields.has(field) ? field : fallback;
  const text = view.mode === 'plain-string' ? (view.text ?? '') : fieldValue(agg, active);

  return (
    <div className={styles.aggBody}>
      {view.mode === 'json-field' && (
        <div className={styles.fieldBar}>
          {(view.fields ?? []).map((f) => (
            <button
              key={f}
              type="button"
              className={f === active ? styles.fieldChipActive : styles.fieldChip}
              onClick={() => onField(f)}
              title={`拼接字段 ${f} 的字符串值`}
            >
              {f}
              <span className={styles.fieldSize}>
                {agg.fields.get(f)?.length.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
      {view.truncated && (
        <div className={styles.aggNote}>内容过长，仅保留前 {AGGREGATE_LIMIT_LABEL}（已截断）</div>
      )}
      {text.length === 0 ? (
        <div className={styles.pending}>无可拼接内容</div>
      ) : (
        <TextViewer key={`${entry.id}:${active}`} text={text} collapsedByDefault={text.length > 2000} />
      )}
    </div>
  );
}

/** Mirrors AGGREGATE_MAX_CHARS in store/netLog.ts (kept in sync via tests). */
const AGGREGATE_LIMIT_LABEL = '100,000 字符';

interface ChunkRowProps {
  readonly chunk: NetStreamChunk;
  /** Gap in ms since the previous chunk; undefined for the first one. */
  readonly gapMs: number | undefined;
  readonly expanded: boolean;
  readonly onToggle: (index: number) => void;
}

function ChunkRow({ chunk, gapMs, expanded, onToggle }: ChunkRowProps): ReactElement {
  const gap = gapMs !== undefined ? `Δ${Math.round(gapMs)}ms` : `+${Math.round(chunk.at)}ms`;
  return (
    <li className={expanded ? styles.chunkItemExpanded : styles.chunkItem}>
      <button
        type="button"
        className={styles.chunkHead}
        onClick={() => onToggle(chunk.index)}
        title={`#${chunk.index} · ${formatBytes(chunk.bytes)} · 起始 +${Math.round(chunk.at)}ms`}
      >
        <span className={styles.chunkCaret}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.chunkKind} data-kind={chunk.kind}>
          {chunk.kind}
        </span>
        <span className={styles.chunkIndex}>#{chunk.index}</span>
        <span className={styles.chunkPreview}>{chunkPreview(chunk)}</span>
        <span className={styles.chunkMeta}>
          {formatBytes(chunk.bytes)} · {gap}
        </span>
      </button>
      {expanded && chunk.sample !== undefined && (
        <div className={styles.chunkBody}>
          <JsonViewer value={chunk.sample} compact />
        </div>
      )}
    </li>
  );
}
