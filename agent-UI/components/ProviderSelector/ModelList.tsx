/**
 * ModelList.tsx — the "模型" tab: searchable, collapsible provider groups.
 *
 * Owns its search query; selecting a model is delegated to the parent so the
 * dropdown can close. While searching, every group is force-expanded so
 * matches are visible.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ProviderEntry } from '../../store/providerConfigStore';
import { fmtCtx, fuzzyMatch, providerIcon } from './providerConfig';
import styles from './ProviderSelector.module.scss';

export interface ModelListProps {
  readonly providers: readonly ProviderEntry[];
  readonly loaded: boolean;
  readonly selectedProviderId: string;
  readonly selectedModelId: string;
  onSelect: (providerId: string, modelId: string) => void;
}

export function ModelList({
  providers,
  loaded,
  selectedProviderId,
  selectedModelId,
  onSelect,
}: ModelListProps): ReactElement {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(providers.filter((p) => p.name !== selectedProviderId).map((p) => p.name)),
  );
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const isSearching = query.trim().length > 0;
  const visible = useMemo(
    () =>
      isSearching
        ? providers
            .map((prov) => ({
              ...prov,
              models: prov.models.filter((m) => fuzzyMatch(query, `${prov.name} ${m.id} ${m.name}`)),
            }))
            .filter((prov) => prov.models.length > 0)
        : providers,
    [providers, query, isSearching],
  );

  function toggleCollapse(name: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <>
      <div className={styles.providerSearch}>
        <input
          ref={searchRef}
          type="text"
          className={styles.providerSearchInput}
          placeholder="搜索模型…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query !== '' && (
          <button
            type="button"
            className={styles.providerSearchClear}
            onClick={() => setQuery('')}
            tabIndex={-1}
            aria-label="清除搜索"
          >
            ✕
          </button>
        )}
      </div>

      <div className={styles.providerList}>
        {!loaded && <div className={styles.providerEmpty}>加载配置中…</div>}
        {loaded && visible.length === 0 && (
          <div className={styles.providerEmpty}>{isSearching ? '无匹配模型' : '无可用提供商'}</div>
        )}
        {visible.map((prov) => {
          const isCollapsed = !isSearching && collapsed.has(prov.name);
          return (
            <div key={prov.name} className={styles.providerGroup}>
              <button
                type="button"
                className={styles.providerGroupLabel}
                onClick={() => toggleCollapse(prov.name)}
                aria-expanded={!isCollapsed}
              >
                <span
                  className={`${styles.providerGroupChevron} ${isCollapsed ? styles.providerGroupChevronCollapsed : ''}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
                <span aria-hidden="true">{providerIcon(prov.name)}</span>
                {prov.name}
                <span className={styles.providerDynamicBadge}>{prov.models.length}</span>
              </button>
              {!isCollapsed && prov.models.length === 0 && (
                <div className={styles.providerEmpty}>无已配置模型</div>
              )}
              {!isCollapsed &&
                prov.models.map((model) => {
                  const active = prov.name === selectedProviderId && model.id === selectedModelId;
                  const ctx = fmtCtx(model.maxInputTokens);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`${styles.providerItem} ${active ? styles.providerItemActive : ''}`}
                      onClick={() => onSelect(prov.name, model.id)}
                    >
                      <span className={styles.providerItemName}>{model.id}</span>
                      <span className={styles.providerItemMeta}>
                        {model.toolCalling && <span className={styles.providerItemOwner}>tools</span>}
                        {model.vision && <span className={styles.providerItemOwner}>vision</span>}
                        {ctx !== '' && <span className={styles.providerItemCtx}>{ctx}</span>}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
}
