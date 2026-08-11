import React, { useEffect } from 'react';
import { useDevOps, selectCollection, selectProject } from '../../store/devopsStore';
import { fetchCollections } from '../../api/collections';
import { fetchProjects } from '../../api/projects';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { WorkItemsPage } from '../workItems/WorkItemsPage';
import { SprintsPage } from '../sprints/SprintsPage';
import { BuildsPage } from '../builds/BuildsPage';
import { GitPage } from '../git/GitPage';
import { TestsPage } from '../tests/TestsPage';
import { ReleasesPage } from '../releases/ReleasesPage';
import { EmptyState } from '../shared/EmptyState';
import styles from './AppLayout.module.scss';

export function AppLayout() {
  const { state, dispatch } = useDevOps();

  // Load collections on mount
  useEffect(() => {
    if (!state.config || state.collectionsLoaded) return;
    fetchCollections(state.config.serverUrl, state.config.pat)
      .then((cols) => dispatch({ type: 'SET_COLLECTIONS', payload: cols }))
      .catch(console.error);
  }, [state.config, state.collectionsLoaded, dispatch]);

  // Load projects when a collection is selected
  useEffect(() => {
    if (!state.config || !state.selectedCollectionId) return;
    const col = state.collections.find((c) => c.id === state.selectedCollectionId);
    if (!col) return;
    if (state.projectsByCollection[state.selectedCollectionId]) return; // already loaded
    fetchProjects(col.url, state.config.pat, col.id)
      .then((projects) =>
        dispatch({
          type: 'SET_PROJECTS',
          payload: { collectionId: col.id, projects },
        }),
      )
      .catch(console.error);
  }, [state.config, state.selectedCollectionId, state.collections, state.projectsByCollection, dispatch]);

  const collection = selectCollection(state);
  const project = selectProject(state);

  function renderMain() {
    if (!project || !collection || !state.config) {
      return (
        <EmptyState
          icon="🗂️"
          title="选择一个项目开始"
          description="从左侧导航栏选择一个 Collection 和项目"
        />
      );
    }

    const ctx = {
      collectionUrl: collection.url,
      project: project.name,
      pat: state.config.pat,
    };

    switch (state.activeView) {
      case 'workItems':
        return <WorkItemsPage {...ctx} />;
      case 'sprints':
        return <SprintsPage {...ctx} />;
      case 'builds':
        return <BuildsPage {...ctx} />;
      case 'git':
        return <GitPage {...ctx} />;
      case 'tests':
        return <TestsPage {...ctx} />;
      case 'releases':
        return <ReleasesPage {...ctx} />;
    }
  }

  return (
    <div className={styles.layout}>
      <Sidebar />
      <div className={styles.main}>
        <Header />
        <div className={styles.content}>{renderMain()}</div>
      </div>
    </div>
  );
}
