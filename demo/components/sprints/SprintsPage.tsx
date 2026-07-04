import React, { useEffect, useState, useRef } from 'react';
import { fetchTeams, fetchTeamSprints, fetchSprintWorkItems, fetchWorkItemDetails, fetchSprintCapacity } from '../../api';
import type { ProjectTeam, TeamSprint, WorkItem, SprintCapacity } from '../../api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { workItemStateBadge } from '../shared/Badge';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Sprints.module.scss';

interface SprintsPageProps {
  collectionUrl: string;
  project: string;
  pat: string;
}

type SprintFilter = 'all' | 'current' | 'past' | 'future';

export function SprintsPage({ collectionUrl, project, pat }: SprintsPageProps) {
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<ProjectTeam | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [sprints, setSprints] = useState<TeamSprint[]>([]);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>('all');

  const [selectedSprint, setSelectedSprint] = useState<TeamSprint | null>(null);
  const [sprintItems, setSprintItems] = useState<WorkItem[]>([]);
  const [sprintCapacity, setSprintCapacity] = useState<SprintCapacity | null>(null);
  const [sprintDetailLoading, setSprintDetailLoading] = useState(false);

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({
    teams, selectedTeam, teamsLoading,
    sprints, sprintsLoading, sprintFilter,
    selectedSprint, sprintItems, sprintCapacity, sprintDetailLoading,
  });
  stateRef.current = {
    teams, selectedTeam, teamsLoading,
    sprints, sprintsLoading, sprintFilter,
    selectedSprint, sprintItems, sprintCapacity, sprintDetailLoading,
  };

  useEffect(() => {
    uiBridge.register('sprints.getState', () => stateRef.current);
    uiBridge.register('sprints.selectTeam', (teamId: string) => {
      const t = stateRef.current.teams.find((x) => x.id === teamId || x.name === teamId);
      setSelectedTeam(t ?? null);
    });
    uiBridge.register('sprints.setFilter', (f: 'all' | 'current' | 'past' | 'future') =>
      setSprintFilter(f),
    );
    uiBridge.register('sprints.selectSprint', (sprintId: string) => {
      const s = stateRef.current.sprints.find((x) => x.id === sprintId || x.name === sprintId);
      setSelectedSprint(s ?? null);
    });
    return () => {
      uiBridge.unregister('sprints.getState');
      uiBridge.unregister('sprints.selectTeam');
      uiBridge.unregister('sprints.setFilter');
      uiBridge.unregister('sprints.selectSprint');
    };
  }, []);

  // Load teams
  useEffect(() => {
    setTeamsLoading(true);
    fetchTeams(collectionUrl, project, pat)
      .then((t) => {
        setTeams(t);
        if (t.length > 0) setSelectedTeam(t[0]);
      })
      .catch(console.error)
      .finally(() => setTeamsLoading(false));
  }, [collectionUrl, project, pat]);

  // Load sprints when team changes
  useEffect(() => {
    if (!selectedTeam) return;
    setSprintsLoading(true);
    setSprints([]);
    setSelectedSprint(null);
    const tf = sprintFilter === 'all' ? undefined : sprintFilter;
    fetchTeamSprints(collectionUrl, project, pat, selectedTeam.name, tf)
      .then(setSprints)
      .catch(console.error)
      .finally(() => setSprintsLoading(false));
  }, [collectionUrl, project, pat, selectedTeam, sprintFilter]);

  // Load sprint detail
  useEffect(() => {
    if (!selectedSprint || !selectedTeam) return;
    setSprintDetailLoading(true);
    setSprintItems([]);
    setSprintCapacity(null);

    Promise.all([
      fetchSprintWorkItems(collectionUrl, project, pat, selectedTeam.name, selectedSprint.id),
      fetchSprintCapacity(collectionUrl, project, pat, selectedTeam.name, selectedSprint.id).catch(() => null),
    ])
      .then(async ([relations, capacity]) => {
        setSprintCapacity(capacity);
        const itemIds = (relations.workItemRelations ?? [])
          .map((r) => r.target.id)
          .filter((id) => id != null);
        if (itemIds.length === 0) {
          setSprintItems([]);
          return;
        }
        const items = await fetchWorkItemDetails(collectionUrl, pat, itemIds.slice(0, 200));
        setSprintItems(items);
      })
      .catch(console.error)
      .finally(() => setSprintDetailLoading(false));
  }, [collectionUrl, project, pat, selectedSprint, selectedTeam]);

  if (teamsLoading) return <div className={styles.page}><Spinner label="加载团队..." /></div>;
  if (teams.length === 0) return (
    <div className={styles.page}>
      <EmptyState icon="👥" title="未找到团队" description="当前项目没有可用团队" />
    </div>
  );

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.teamSelect}>
          <label className={styles.toolbarLabel}>团队</label>
          <select
            className={styles.select}
            value={selectedTeam?.id ?? ''}
            onChange={(e) => {
              const t = teams.find((x) => x.id === e.target.value);
              setSelectedTeam(t ?? null);
            }}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterTabs}>
          {(['all', 'current', 'past', 'future'] as SprintFilter[]).map((f) => (
            <button
              key={f}
              className={`${styles.filterTab} ${sprintFilter === f ? styles.filterTabActive : ''}`}
              onClick={() => setSprintFilter(f)}
            >
              {f === 'all' ? '全部' : f === 'current' ? '当前' : f === 'past' ? '过去' : '未来'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        {/* Sprint list */}
        <aside className={styles.sprintList}>
          {sprintsLoading ? (
            <Spinner size="sm" />
          ) : sprints.length === 0 ? (
            <EmptyState icon="📅" title="暂无 Sprint" />
          ) : (
            sprints.map((s) => (
              <button
                key={s.id}
                className={`${styles.sprintCard} ${selectedSprint?.id === s.id ? styles.sprintCardActive : ''} ${styles['tf_' + (s.attributes?.timeFrame ?? 'unknown')]}`}
                onClick={() => setSelectedSprint(s)}
              >
                <div className={styles.sprintName}>{s.name}</div>
                {s.attributes?.startDate && (
                  <div className={styles.sprintDates}>
                    <span>{fmt(s.attributes.startDate)}</span>
                    <span> → </span>
                    <span>{fmt(s.attributes.finishDate)}</span>
                  </div>
                )}
                {s.attributes?.timeFrame && (
                  <span className={`${styles.sprintBadge} ${styles['tf_' + s.attributes.timeFrame]}`}>
                    {s.attributes.timeFrame === 'current' ? '当前' : s.attributes.timeFrame === 'past' ? '已结束' : '即将到来'}
                  </span>
                )}
              </button>
            ))
          )}
        </aside>

        {/* Sprint detail */}
        <main className={styles.sprintDetail}>
          {!selectedSprint ? (
            <EmptyState icon="⚡" title="选择一个 Sprint" description="点击左侧的 Sprint 查看详情" />
          ) : sprintDetailLoading ? (
            <Spinner label="加载 Sprint 数据..." />
          ) : (
            <>
              <div className={styles.detailHeader}>
                <h2 className={styles.detailTitle}>{selectedSprint.name}</h2>
                {selectedSprint.attributes?.startDate && (
                  <span className={styles.detailDates}>
                    {fmt(selectedSprint.attributes.startDate)} —{' '}
                    {fmt(selectedSprint.attributes.finishDate)}
                  </span>
                )}
              </div>

              {/* Capacity summary */}
              {sprintCapacity && sprintCapacity.teamMembers?.length > 0 && (
                <div className={styles.capacitySection}>
                  <h3 className={styles.sectionTitle}>容量</h3>
                  <div className={styles.capacityGrid}>
                    {sprintCapacity.teamMembers.map((m, i) => {
                      const totalCap = m.activities.reduce(
                        (sum, a) => sum + (a.capacityPerDay ?? 0),
                        0,
                      );
                      return (
                        <div key={i} className={styles.capacityCard}>
                          <div className={styles.memberName}>
                            {m.teamMember.displayName ?? '—'}
                          </div>
                          <div className={styles.memberCap}>
                            {totalCap > 0 ? `${totalCap} h/day` : '未设置'}
                          </div>
                          {m.daysOff?.length > 0 && (
                            <div className={styles.memberDaysOff}>
                              休假: {m.daysOff.length} 段
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Work items */}
              <div className={styles.sprintItemsSection}>
                <h3 className={styles.sectionTitle}>
                  工作项 <span className={styles.countBadge}>{sprintItems.length}</span>
                </h3>
                {sprintItems.length === 0 ? (
                  <EmptyState icon="📋" title="此 Sprint 暂无工作项" />
                ) : (
                  <table className={styles.sprintTable}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>类型</th>
                        <th>标题</th>
                        <th>状态</th>
                        <th>负责人</th>
                        <th>剩余</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sprintItems.map((item) => (
                        <tr key={item.id} className={styles.sprintRow}>
                          <td className={styles.sprintTdId}>#{item.id}</td>
                          <td>
                            <span className={styles.sprintType}>{item.type}</span>
                          </td>
                          <td className={styles.sprintTdTitle}>{item.title}</td>
                          <td>{workItemStateBadge(item.state)}</td>
                          <td className={styles.sprintTdAssignee}>{item.assignedTo ?? '—'}</td>
                          <td className={styles.sprintTdRemaining}>
                            {item.remainingWork != null ? item.remainingWork : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function fmt(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
