import { useEffect } from 'react';
import { useDevOps, selectCollection, selectProject } from '../../store/devopsStore';
import type { AppView } from '../../store/devopsStore';
import { uiBridge } from '../../tools/uiBridge';

import styles from './Header.module.scss';

const NAV_ITEMS: { view: AppView; label: string; icon: string }[] = [
  { view: 'workItems', label: '工作项', icon: '☑' },
  { view: 'sprints', label: 'Sprint', icon: '⚡' },
  { view: 'builds', label: '构建', icon: '⚙' },
  { view: 'git', label: 'Git', icon: '⑂' },
  { view: 'tests', label: '测试', icon: '✓' },
  { view: 'releases', label: '发布', icon: '🚀' },
];

export function Header() {
  const { state, dispatch } = useDevOps();
  const collection = selectCollection(state);
  const project = selectProject(state);

  function handleLogout() {
    dispatch({ type: 'LOGOUT' });
  }

  useEffect(() => {
    uiBridge.register('app.switchView', (view: AppView) =>
      dispatch({ type: 'SET_VIEW', payload: view }),
    );
    uiBridge.register('app.logout', handleLogout);
    return () => {
      uiBridge.unregister('app.switchView');
      uiBridge.unregister('app.logout');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb} aria-label="breadcrumb">
          {collection && (
            <>
              <span className={styles.crumb}>{collection.name}</span>
              {project && (
                <>
                  <span className={styles.sep}>/</span>
                  <span className={styles.crumb + ' ' + styles.crumbActive}>{project.name}</span>
                </>
              )}
            </>
          )}
          {!collection && <span className={styles.crumb}>Azure DevOps</span>}
        </nav>

        {/* Editor toggle button — always visible */}
        <button
          className={`${styles.tab} ${state.activeView === 'editor' ? styles.tabActive : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: 'editor' })}
          title="打开编辑器"
        >
          <span className={styles.tabIcon}>⌨</span>
          编辑器
        </button>

        {/* View tabs (only when a project is selected) */}
        {project && state.activeView !== 'editor' && (
          <nav className={styles.tabs} aria-label="views">
            {NAV_ITEMS.map(({ view, label, icon }) => (
              <button
                key={view}
                className={`${styles.tab} ${state.activeView === view ? styles.tabActive : ''}`}
                onClick={() => dispatch({ type: 'SET_VIEW', payload: view })}
              >
                <span className={styles.tabIcon}>{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className={styles.right}>
        {state.currentUser && (
          <span className={styles.userName} title={state.currentUser.uniqueName}>
            {state.currentUser.displayName}
          </span>
        )}
        <button className={styles.logoutBtn} onClick={handleLogout} title="退出登录">
          ⏻
        </button>
      </div>
    </header>
  );
}
