import React from 'react';
import type { BuildDefinitionRef } from '../../api';
import { buildResultBadge } from '../shared/Badge';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { Pagination } from '../shared/Pagination';
import styles from './Builds.module.scss';

const PAGE_SIZE = 20;

interface DefListProps {
  defs: BuildDefinitionRef[];
  loading: boolean;
  search: string;
  selectedId: number | null;
  onSearchChange: (v: string) => void;
  onSelect: (id: number) => void;
}

export function DefList({ defs, loading, search, selectedId, onSearchChange, onSelect }: DefListProps) {
  const [page, setPage] = React.useState(0);

  // Reset page when search or defs change
  React.useEffect(() => { setPage(0); }, [search, defs.length]);

  const filtered = defs.filter((d) =>
    search ? d.name.toLowerCase().includes(search.toLowerCase()) : true,
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <aside className={styles.defsPanel}>
      <div className={styles.defsPanelHeader}>
        <input
          type="search"
          className={styles.defSearch}
          placeholder="搜索 Pipeline..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {loading ? (
        <Spinner size="sm" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="⚙" title="暂无 Pipeline" />
      ) : (
        <>
          <ul className={styles.defList}>
            {paged.map((def) => {
              const lb = def.latestBuild;
              return (
                <li
                  key={def.id}
                  className={`${styles.defItem} ${selectedId === def.id ? styles.defItemActive : ''}`}
                  onClick={() => onSelect(def.id)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelect(def.id); }}
                >
                  <div className={styles.defName} title={def.name}>{def.name}</div>
                  <div className={styles.defMeta}>
                    <span className={styles.defPath}>{def.path}</span>
                    {lb && (
                      <span className={styles.defLastBuild}>
                        {buildResultBadge(lb.status ?? 'none', lb.result)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {totalPages > 1 && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </aside>
  );
}
