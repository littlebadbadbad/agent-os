import React, { useState, useEffect, useRef } from 'react';
import { useDevOps, selectCollection } from '../../store/devopsStore';
import { Spinner } from '../shared/Spinner';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Sidebar.module.scss';

export function Sidebar() {
  const { state, dispatch } = useDevOps();
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({ expandedCollections, collapsed });
  stateRef.current = { expandedCollections, collapsed };

  useEffect(() => {
    uiBridge.register('sidebar.setCollapsed', setCollapsed);
    uiBridge.register('sidebar.expandCollection', (id: string) => {
      setExpandedCollections((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      dispatch({ type: 'SELECT_COLLECTION', payload: id });
    });
    uiBridge.register('sidebar.collapseCollection', (id: string) => {
      setExpandedCollections((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
    uiBridge.register('sidebar.getState', () => ({
      collapsed: stateRef.current.collapsed,
      expandedCollectionIds: [...stateRef.current.expandedCollections],
    }));
    return () => {
      uiBridge.unregister('sidebar.setCollapsed');
      uiBridge.unregister('sidebar.expandCollection');
      uiBridge.unregister('sidebar.collapseCollection');
      uiBridge.unregister('sidebar.getState');
    };
    // dispatch is stable; no need to include
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleCollection(id: string) {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Select collection when expanding
        dispatch({ type: 'SELECT_COLLECTION', payload: id });
      }
      return next;
    });
  }

  function selectProject(projectId: string, collectionId: string) {
    if (state.selectedCollectionId !== collectionId) {
      dispatch({ type: 'SELECT_COLLECTION', payload: collectionId });
    }
    dispatch({ type: 'SELECT_PROJECT', payload: projectId });
  }

  const collection = selectCollection(state);

  if (collapsed) {
    return (
      <div className={`${styles.sidebar} ${styles.collapsed}`}>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(false)}
          title="展开侧边栏"
        >
          ›
        </button>
        {collection && (
          <div className={styles.collapsedCollLabel} title={collection.name}>
            {collection.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Collections</span>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(true)}
          title="收起侧边栏"
        >
          ‹
        </button>
      </div>

      <nav className={styles.nav}>
        {!state.collectionsLoaded && state.config && (
          <div className={styles.loadingRow}>
            <Spinner size="sm" />
          </div>
        )}

        {state.collections.map((col) => {
          const isExpanded = expandedCollections.has(col.id);
          const isActiveCollection = state.selectedCollectionId === col.id;
          const projects = state.projectsByCollection[col.id] ?? [];

          return (
            <div key={col.id} className={styles.collectionGroup}>
              <button
                className={`${styles.collectionBtn} ${isActiveCollection ? styles.activeCollection : ''}`}
                onClick={() => toggleCollection(col.id)}
              >
                <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}>
                  ›
                </span>
                <span className={styles.collectionIcon}>⬡</span>
                <span className={styles.collectionName} title={col.name}>
                  {col.name}
                </span>
              </button>

              {isExpanded && (
                <div className={styles.projectList}>
                  {projects.length === 0 && isActiveCollection && !state.projectsByCollection[col.id] ? (
                    <div className={styles.loadingRow}>
                      <Spinner size="sm" />
                    </div>
                  ) : projects.length === 0 ? (
                    <div className={styles.emptyProjects}>暂无项目</div>
                  ) : (
                    projects.map((p) => (
                      <button
                        key={p.id}
                        className={`${styles.projectBtn} ${state.selectedProjectId === p.id ? styles.activeProject : ''}`}
                        onClick={() => selectProject(p.id, col.id)}
                        title={p.description ?? p.name}
                      >
                        <span className={styles.projectDot} />
                        <span className={styles.projectName}>{p.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
