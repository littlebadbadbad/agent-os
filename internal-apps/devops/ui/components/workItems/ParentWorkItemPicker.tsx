import React, { useState, useEffect, useRef, useCallback } from 'react';
import { searchWorkItemsByTitle } from '../../api';
import styles from './WorkItems.module.scss';

export interface ParentCandidate {
  id: number;
  title: string;
  type: string;
}

interface ParentWorkItemPickerProps {
  collectionUrl: string;
  project: string;
  pat: string;
  /** Current parent work item (may be pre-populated from the existing item). */
  value: ParentCandidate | null;
  onChange: (parent: ParentCandidate | null) => void;
  disabled?: boolean;
}

export function ParentWorkItemPicker({
  collectionUrl,
  project,
  pat,
  value,
  onChange,
  disabled,
}: ParentWorkItemPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ParentCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const items = await searchWorkItemsByTitle(collectionUrl, project, pat, text, 15);
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [collectionUrl, project, pat],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  function handleSelect(item: ParentCandidate) {
    onChange(item);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery('');
    setResults([]);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setOpen(true);
  }

  return (
    <div ref={containerRef} className={styles.parentPicker}>
      {value ? (
        <div className={styles.parentSelected}>
          <span className={styles.parentSelectedId}>#{value.id}</span>
          <span className={styles.parentSelectedType}>{value.type}</span>
          <span className={styles.parentSelectedTitle}>{value.title}</span>
          {!disabled && (
            <button
              type="button"
              className={styles.parentClearBtn}
              onClick={handleClear}
              title="移除父工作项"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className={styles.parentInputWrapper}>
          <input
            className={styles.editInput}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => query && setOpen(true)}
            placeholder="输入标题或 #ID 搜索父工作项..."
            disabled={disabled}
          />
          {loading && <span className={styles.parentSpinner}>…</span>}
        </div>
      )}

      {open && results.length > 0 && (
        <div className={styles.parentDropdown}>
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.parentDropdownItem}
              onClick={() => handleSelect(item)}
            >
              <span className={styles.parentDropdownId}>#{item.id}</span>
              <span className={styles.parentDropdownType}>{item.type}</span>
              <span className={styles.parentDropdownTitle}>{item.title}</span>
            </button>
          ))}
        </div>
      )}

      {open && !loading && query.trim() && results.length === 0 && (
        <div className={styles.parentDropdown}>
          <div className={styles.parentDropdownEmpty}>未找到工作项</div>
        </div>
      )}
    </div>
  );
}
