import React, { useEffect, useState, useRef } from 'react';
import {
  fetchReleaseDefinitions,
  fetchReleases,
  createRelease,
} from '../../api';
import type {
  ReleaseDefinitionRef,
  Release,
  FetchReleasesOpts,
} from '../../api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { Pagination } from '../shared/Pagination';
import { ReleaseCard } from './ReleaseCard';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Releases.module.scss';

const DEF_PAGE_SIZE = 20;
const RELEASES_TOP = 30;

interface ReleasesPageProps {
  collectionUrl: string;
  project: string;
  pat: string;
}

export function ReleasesPage({ collectionUrl, project, pat }: ReleasesPageProps) {
  const [defs, setDefs] = useState<ReleaseDefinitionRef[]>([]);
  const [defsLoading, setDefsLoading] = useState(true);
  const [defSearch, setDefSearch] = useState('');
  const [defsPage, setDefsPage] = useState(0);

  const [selectedDefId, setSelectedDefId] = useState<number | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({
    defs, defsLoading, defSearch, defsPage,
    selectedDefId, releases, releasesLoading, statusFilter, creating,
  });
  stateRef.current = {
    defs, defsLoading, defSearch, defsPage,
    selectedDefId, releases, releasesLoading, statusFilter, creating,
  };

  useEffect(() => {
    uiBridge.register('releases.getState', () => stateRef.current);
    uiBridge.register('releases.setDefSearch', (q: string) => {
      setDefSearch(q);
      setDefsPage(0);
    });
    uiBridge.register('releases.setDefsPage', setDefsPage);
    uiBridge.register('releases.selectDef', (id: number) => setSelectedDefId(id));
    uiBridge.register('releases.setStatusFilter', setStatusFilter);
    uiBridge.register('releases.create', () => handleCreateRelease());
    return () => {
      [
        'releases.getState', 'releases.setDefSearch', 'releases.setDefsPage',
        'releases.selectDef', 'releases.setStatusFilter', 'releases.create',
      ].forEach((k) => uiBridge.unregister(k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDefsLoading(true);
    fetchReleaseDefinitions(collectionUrl, project, pat, defSearch || undefined, 200)
      .then(setDefs)
      .catch(console.error)
      .finally(() => setDefsLoading(false));
  }, [collectionUrl, project, pat, defSearch]);

  useEffect(() => {
    if (selectedDefId == null) return;
    setReleasesLoading(true);
    setReleases([]);
    const opts: FetchReleasesOpts = {
      definitionId: selectedDefId,
      top: RELEASES_TOP,
      statusFilter: statusFilter || undefined,
      expand: 'environments',
    };
    fetchReleases(collectionUrl, project, pat, opts)
      .then(setReleases)
      .catch(console.error)
      .finally(() => setReleasesLoading(false));
  }, [collectionUrl, project, pat, selectedDefId, statusFilter]);

  async function handleCreateRelease() {
    if (selectedDefId == null) return;
    setCreating(true);
    try {
      await createRelease(collectionUrl, project, pat, selectedDefId);
      const opts: FetchReleasesOpts = {
        definitionId: selectedDefId,
        top: RELEASES_TOP,
        expand: 'environments',
      };
      const updated = await fetchReleases(collectionUrl, project, pat, opts);
      setReleases(updated);
    } catch (e) {
      alert('创建发布失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCreating(false);
    }
  }

  const filtered = defs.filter((d) =>
    defSearch ? d.name.toLowerCase().includes(defSearch.toLowerCase()) : true,
  );
  const defPages = Math.ceil(filtered.length / DEF_PAGE_SIZE);
  const pagedDefs = filtered.slice(defsPage * DEF_PAGE_SIZE, (defsPage + 1) * DEF_PAGE_SIZE);
  const selectedDef = defs.find((d) => d.id === selectedDefId);

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <aside className={styles.defsPanel}>
          <div className={styles.defsPanelHeader}>
            <input
              type="search"
              className={styles.defSearch}
              placeholder="搜索发布定义..."
              value={defSearch}
              onChange={(e) => {
                setDefSearch(e.target.value);
                setDefsPage(0);
              }}
            />
          </div>

          {defsLoading ? (
            <Spinner size="sm" />
          ) : filtered.length === 0 ? (
            <EmptyState icon="🚀" title="暂无发布定义" />
          ) : (
            <>
              <ul className={styles.defList}>
                {pagedDefs.map((def) => (
                  <li
                    key={def.id}
                    className={`${styles.defItem} ${selectedDefId === def.id ? styles.defItemActive : ''}`}
                    onClick={() => setSelectedDefId(def.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelectedDefId(def.id);
                    }}
                  >
                    <div className={styles.defName} title={def.name}>
                      {def.name}
                    </div>
                    <div className={styles.defMeta}>
                      <span className={styles.defPath}>{def.path}</span>
                      {def.modifiedBy?.displayName && (
                        <span className={styles.defModBy}>{def.modifiedBy.displayName}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {defPages > 1 && (
                <Pagination
                  page={defsPage}
                  pageSize={DEF_PAGE_SIZE}
                  total={filtered.length}
                  onPageChange={setDefsPage}
                />
              )}
            </>
          )}
        </aside>

        <main className={styles.releasesPanel}>
          {!selectedDef ? (
            <EmptyState icon="🚀" title="选择一个发布定义" description="从左侧选择发布定义查看历史记录" />
          ) : (
            <>
              <div className={styles.releasesHeader}>
                <div className={styles.releasesTitle}>
                  <h2>{selectedDef.name}</h2>
                  <span className={styles.releasesPath}>{selectedDef.path}</span>
                </div>
                <div className={styles.releasesActions}>
                  <select
                    className={styles.statusFilter}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">全部状态</option>
                    <option value="active">活跃</option>
                    <option value="abandoned">已放弃</option>
                    <option value="draft">草稿</option>
                  </select>
                  <button
                    className={styles.createBtn}
                    onClick={handleCreateRelease}
                    disabled={creating}
                  >
                    {creating ? '创建中...' : '🚀 创建发布'}
                  </button>
                </div>
              </div>

              {releasesLoading ? (
                <Spinner label="加载发布记录..." />
              ) : releases.length === 0 ? (
                <EmptyState icon="🚀" title="暂无发布记录" />
              ) : (
                <div className={styles.releasesList}>
                  {releases.map((rel) => (
                    <ReleaseCard key={rel.id} release={rel} />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
