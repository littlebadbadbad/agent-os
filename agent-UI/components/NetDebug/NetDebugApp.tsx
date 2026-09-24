/**
 * NetDebugApp — native desktop app body for the network console.
 *
 * Records every `call()` / `connectStream()` made through the frontend API
 * client (see app/netLogClient.ts) and presents them like a browser Network
 * tab: a filterable request table on the left and a payload inspector on the
 * right.
 *
 * Registered as a built-in app in `nativeApps.tsx` for local dev builds only
 * (`import.meta.env.DEV`). The AppWindow base provides all chrome — title
 * bar, icon, close/minimise/maximise — so this component renders only the
 * body content, filling the window.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { netLog } from '../../store/netLog';
import type { NetLogEntry } from '../../store/netLog';
import { installNetDebugBridge } from './debugBridge';
import { useNetLog } from './useNetLog';
import { NetTable } from './NetTable';
import { NetDetail } from './NetDetail';
import styles from './NetDebugApp.module.scss';

// Debug-only console bridge (no-op outside debug builds). Loaded via the
// native-app registry, so it is installed whenever this module is reachable.
installNetDebugBridge();

type KindFilter = 'all' | 'call' | 'stream';

const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'call', label: 'API' },
  { value: 'stream', label: '流' },
];

export function NetDebugApp(): ReactElement {
  const snapshot = useNetLog();
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [textFilter, setTextFilter] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const entries = snapshot.entries;

  // Keep a valid selection as entries are appended or cleared.
  useEffect(() => {
    if (selectedId !== null && !entries.some((e) => e.id === selectedId)) {
      setSelectedId(null);
    }
  }, [entries, selectedId]);

  const filtered = useMemo(
    () => filterEntries(entries, kindFilter, textFilter),
    [entries, kindFilter, textFilter],
  );

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const handleClear = useCallback(() => {
    netLog.clear();
    setSelectedId(null);
  }, []);

  const counts = useMemo(() => {
    let call = 0;
    let stream = 0;
    let error = 0;
    for (const e of entries) {
      if (e.kind === 'call') call += 1;
      else stream += 1;
      if ((e.kind === 'call' && e.status === 'error') || (e.kind === 'stream' && e.phase === 'error')) {
        error += 1;
      }
    }
    return { call, stream, error };
  }, [entries]);

  return (
    <div className={styles.container}>
      {/* Toolbar: kind filter + search + stats + clear */}
      <div className={styles.toolbar}>
        <div className={styles.kindGroup}>
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={kindFilter === f.value ? styles.kindActive : styles.kindBtn}
              onClick={() => setKindFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="按 app / 名称过滤…"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
        />
        <span className={styles.stat}>
          {counts.call} API · {counts.stream} 流
          {counts.error > 0 && <span className={styles.statError}> · {counts.error} 错误</span>}
        </span>
        <button type="button" className={styles.iconBtn} onClick={handleClear} title="清空记录">
          清空
        </button>
      </div>

      {/* Body: table + detail */}
      <div className={styles.body}>
        <div className={styles.tablePane}>
          <NetTable entries={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className={styles.detailPane}>
          <NetDetail entry={selected} />
        </div>
      </div>
    </div>
  );
}

function filterEntries(
  entries: readonly NetLogEntry[],
  kind: KindFilter,
  text: string,
): readonly NetLogEntry[] {
  const needle = text.trim().toLowerCase();
  if (kind === 'all' && needle === '') return entries;
  return entries.filter((e) => {
    if (kind !== 'all' && e.kind !== kind) return false;
    if (needle === '') return true;
    return e.appId.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle);
  });
}
