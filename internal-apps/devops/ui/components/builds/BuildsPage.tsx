import { useEffect, useState, useRef } from 'react';
import { fetchBuildDefinitions, fetchBuilds, queueBuild, fetchBuildArtifacts } from '../../api';
import type { BuildDefinitionRef, Build, FetchBuildsOpts, BuildArtifact } from '../../api';
import { EmptyState } from '../shared/EmptyState';
import { DefList } from './DefList';
import { RunsTable } from './RunsTable';
import { QueueBuildDialog } from './QueueBuildDialog';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Builds.module.scss';

const RUNS_TOP = 30;

interface BuildsPageProps {
  collectionUrl: string;
  project: string;
  pat: string;
}

export function BuildsPage({ collectionUrl, project, pat }: BuildsPageProps) {
  const [defs, setDefs] = useState<BuildDefinitionRef[]>([]);
  const [defsLoading, setDefsLoading] = useState(true);
  const [defSearch, setDefSearch] = useState('');

  const [selectedDefId, setSelectedDefId] = useState<number | null>(null);
  const [runs, setRuns] = useState<Build[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const [showQueueDialog, setShowQueueDialog] = useState(false);
  const [queueing, setQueueing] = useState(false);

  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [artifactsMap, setArtifactsMap] = useState<Record<number, BuildArtifact[]>>({});
  const [artifactsLoading, setArtifactsLoading] = useState(false);

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({
    defs, defsLoading, defSearch,
    selectedDefId, runs, runsLoading, statusFilter,
    showQueueDialog, queueing, expandedRunId, artifactsMap, artifactsLoading,
  });
  stateRef.current = {
    defs, defsLoading, defSearch,
    selectedDefId, runs, runsLoading, statusFilter,
    showQueueDialog, queueing, expandedRunId, artifactsMap, artifactsLoading,
  };

  useEffect(() => {
    uiBridge.register('builds.getState', () => stateRef.current);
    uiBridge.register('builds.setDefSearch', setDefSearch);
    uiBridge.register('builds.selectDef', (id: number) => setSelectedDefId(id));
    uiBridge.register('builds.setStatusFilter', setStatusFilter);
    uiBridge.register('builds.openQueueDialog', () => setShowQueueDialog(true));
    uiBridge.register('builds.closeQueueDialog', () => setShowQueueDialog(false));
    uiBridge.register('builds.toggleRunExpand', (id: number) =>
      setExpandedRunId((prev) => (prev === id ? null : id)),
    );
    return () => {
      [
        'builds.getState', 'builds.setDefSearch', 'builds.selectDef',
        'builds.setStatusFilter', 'builds.openQueueDialog', 'builds.closeQueueDialog',
        'builds.toggleRunExpand',
      ].forEach((k) => uiBridge.unregister(k));
    };
  }, []);

  // Load all definitions upfront; DefList filters client-side
  useEffect(() => {
    setDefsLoading(true);
    fetchBuildDefinitions(collectionUrl, project, pat, undefined, 500)
      .then(setDefs)
      .catch(console.error)
      .finally(() => setDefsLoading(false));
  }, [collectionUrl, project, pat]);

  // Load runs when definition or result filter changes
  useEffect(() => {
    if (selectedDefId == null) return;
    setRunsLoading(true);
    setRuns([]);
    setExpandedRunId(null);
    const opts: FetchBuildsOpts = {
      definitionIds: [selectedDefId],
      top: RUNS_TOP,
      resultFilter: statusFilter || undefined,
    };
    fetchBuilds(collectionUrl, project, pat, opts)
      .then(setRuns)
      .catch(console.error)
      .finally(() => setRunsLoading(false));
  }, [collectionUrl, project, pat, selectedDefId, statusFilter]);

  // Lazy-load artifacts when a run is expanded
  useEffect(() => {
    if (expandedRunId == null) return;
    if (artifactsMap[expandedRunId] !== undefined) return;
    setArtifactsLoading(true);
    fetchBuildArtifacts(collectionUrl, project, pat, expandedRunId)
      .then((arts) => setArtifactsMap((prev) => ({ ...prev, [expandedRunId]: arts })))
      .catch(console.error)
      .finally(() => setArtifactsLoading(false));
  }, [collectionUrl, project, pat, expandedRunId, artifactsMap]);

  async function handleConfirmQueue(branch: string, params: Record<string, string>) {
    if (selectedDefId == null) return;
    setQueueing(true);
    try {
      // ADO expects parameters as a JSON-encoded string
      const parametersJson = Object.keys(params).length > 0 ? JSON.stringify(params) : undefined;
      await queueBuild(collectionUrl, project, pat, selectedDefId, branch, parametersJson);
      setShowQueueDialog(false);
      // Refresh runs list
      const opts: FetchBuildsOpts = { definitionIds: [selectedDefId], top: RUNS_TOP };
      setRuns(await fetchBuilds(collectionUrl, project, pat, opts));
    } catch (e) {
      alert('触发构建失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setQueueing(false);
    }
  }

  const selectedDef = defs.find((d) => d.id === selectedDefId);

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <DefList
          defs={defs}
          loading={defsLoading}
          search={defSearch}
          selectedId={selectedDefId}
          onSearchChange={setDefSearch}
          onSelect={setSelectedDefId}
        />

        <main className={styles.runsPanel}>
          {!selectedDef ? (
            <EmptyState icon="⚙" title="选择一个 Pipeline" description="从左侧选择一个构建定义查看运行记录" />
          ) : (
            <>
              <div className={styles.runsHeader}>
                <div className={styles.runsTitle}>
                  <h2>{selectedDef.name}</h2>
                  <span className={styles.runsPath}>{selectedDef.path}</span>
                </div>
                <div className={styles.runsActions}>
                  <select
                    className={styles.resultFilter}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">全部结果</option>
                    <option value="succeeded">成功</option>
                    <option value="failed">失败</option>
                    <option value="partiallySucceeded">部分成功</option>
                    <option value="canceled">已取消</option>
                  </select>
                  <button
                    className={styles.queueBtn}
                    onClick={() => setShowQueueDialog(true)}
                    disabled={queueing}
                  >
                    ▶ 触发构建
                  </button>
                </div>
              </div>

              <RunsTable
                runs={runs}
                loading={runsLoading}
                expandedRunId={expandedRunId}
                artifactsMap={artifactsMap}
                artifactsLoading={artifactsLoading}
                onToggleExpand={(id) => setExpandedRunId((prev) => (prev === id ? null : id))}
              />
            </>
          )}
        </main>
      </div>

      {showQueueDialog && selectedDefId != null && selectedDef != null && (
        <QueueBuildDialog
          collectionUrl={collectionUrl}
          project={project}
          pat={pat}
          definitionId={selectedDefId}
          definitionName={selectedDef.name}
          submitting={queueing}
          onConfirm={handleConfirmQueue}
          onCancel={() => setShowQueueDialog(false)}
        />
      )}
    </div>
  );
}