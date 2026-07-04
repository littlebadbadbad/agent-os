import React, { useEffect, useState, useRef } from 'react';
import { fetchTestPlans, fetchTestRuns, fetchTestResults, fetchTestSuites, fetchTestCases } from '../../api';
import type { TestPlan, TestRun, TestResult, TestSuite, TestCase } from '../../api';
import { testOutcomeBadge } from '../shared/Badge';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Tests.module.scss';

interface TestsPageProps {
  collectionUrl: string;
  project: string;
  pat: string;
}

export function TestsPage({ collectionUrl, project, pat }: TestsPageProps) {
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState<number | null>(null);

  const [cases, setCases] = useState<TestCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);

  const [runs, setRuns] = useState<TestRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const [results, setResults] = useState<TestResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState('');

  // view mode: 'suites' (plan → suites → cases) or 'runs' (plan → runs → results)
  const [mode, setMode] = useState<'suites' | 'runs'>('suites');

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({
    plans, plansLoading, selectedPlanId,
    suites, suitesLoading, selectedSuiteId, cases, casesLoading,
    runs, runsLoading, selectedRunId, results, resultsLoading, outcomeFilter, mode,
  });
  stateRef.current = {
    plans, plansLoading, selectedPlanId,
    suites, suitesLoading, selectedSuiteId, cases, casesLoading,
    runs, runsLoading, selectedRunId, results, resultsLoading, outcomeFilter, mode,
  };

  useEffect(() => {
    uiBridge.register('tests.getState', () => stateRef.current);
    uiBridge.register('tests.switchMode', (m: 'suites' | 'runs') => setMode(m));
    uiBridge.register('tests.selectPlan', (planId: number) => {
      setSelectedPlanId(planId);
      setSelectedRunId(null);
    });
    uiBridge.register('tests.selectSuite', setSelectedSuiteId);
    uiBridge.register('tests.selectRun', setSelectedRunId);
    uiBridge.register('tests.setOutcomeFilter', setOutcomeFilter);
    return () => {
      [
        'tests.getState', 'tests.switchMode', 'tests.selectPlan',
        'tests.selectSuite', 'tests.selectRun', 'tests.setOutcomeFilter',
      ].forEach((k) => uiBridge.unregister(k));
    };
  }, []);

  // Load test plans
  useEffect(() => {
    setPlansLoading(true);
    fetchTestPlans(collectionUrl, project, pat)
      .then(setPlans)
      .catch(console.error)
      .finally(() => setPlansLoading(false));
  }, [collectionUrl, project, pat]);

  // Load suites when plan selected
  useEffect(() => {
    if (selectedPlanId == null) return;
    setSuitesLoading(true);
    setSuites([]);
    setSelectedSuiteId(null);
    setCases([]);
    fetchTestSuites(collectionUrl, project, pat, selectedPlanId)
      .then(setSuites)
      .catch(console.error)
      .finally(() => setSuitesLoading(false));
  }, [collectionUrl, project, pat, selectedPlanId]);

  // Load cases when suite selected
  useEffect(() => {
    if (selectedPlanId == null || selectedSuiteId == null) return;
    setCasesLoading(true);
    setCases([]);
    fetchTestCases(collectionUrl, project, pat, selectedPlanId, selectedSuiteId)
      .then(setCases)
      .catch(console.error)
      .finally(() => setCasesLoading(false));
  }, [collectionUrl, project, pat, selectedPlanId, selectedSuiteId]);

  // Load runs when plan selected (runs mode)
  useEffect(() => {
    if (selectedPlanId == null || mode !== 'runs') return;
    setRunsLoading(true);
    setRuns([]);
    setSelectedRunId(null);
    fetchTestRuns(collectionUrl, project, pat, selectedPlanId, 30)
      .then(setRuns)
      .catch(console.error)
      .finally(() => setRunsLoading(false));
  }, [collectionUrl, project, pat, selectedPlanId, mode]);

  // Load results when run selected
  useEffect(() => {
    if (selectedRunId == null) return;
    setResultsLoading(true);
    setResults([]);
    const outcomes =
      outcomeFilter ? [outcomeFilter] : undefined;
    fetchTestResults(collectionUrl, project, pat, selectedRunId, 100, outcomes)
      .then(setResults)
      .catch(console.error)
      .finally(() => setResultsLoading(false));
  }, [collectionUrl, project, pat, selectedRunId, outcomeFilter]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const selectedSuite = suites.find((s) => s.id === selectedSuiteId);
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <div className={styles.page}>
      <div className={styles.modeToggle}>
        <button
          className={`${styles.modeBtn} ${mode === 'suites' ? styles.modeBtnActive : ''}`}
          onClick={() => setMode('suites')}
        >
          套件 / 测试用例
        </button>
        <button
          className={`${styles.modeBtn} ${mode === 'runs' ? styles.modeBtnActive : ''}`}
          onClick={() => setMode('runs')}
        >
          运行记录
        </button>
      </div>
      <div className={styles.body}>
        {/* Plans panel */}
        <aside className={styles.plansPanel}>
          <div className={styles.panelHeader}>测试计划</div>
          {plansLoading ? (
            <Spinner size="sm" />
          ) : plans.length === 0 ? (
            <EmptyState icon="✓" title="暂无测试计划" />
          ) : (
            <ul className={styles.planList}>
              {plans.map((plan) => (
                <li
                  key={plan.id}
                  className={`${styles.planItem} ${selectedPlanId === plan.id ? styles.planItemActive : ''}`}
                  onClick={() => { setSelectedPlanId(plan.id); setSelectedRunId(null); }}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelectedPlanId(plan.id); }}
                >
                  <div className={styles.planName}>{plan.name}</div>
                  <div className={styles.planMeta}>
                    {plan.state && <span className={styles.planState}>{plan.state}</span>}
                    {plan.owner?.displayName && (
                      <span className={styles.planOwner}>{plan.owner.displayName}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {mode === 'suites' ? (
          <>
            {/* Suites panel */}
            <aside className={styles.runsPanel}>
              <div className={styles.panelHeader}>
                {selectedPlan ? `${selectedPlan.name} — 套件` : '测试套件'}
              </div>
              {!selectedPlanId ? (
                <div className={styles.placeholder}>← 请选择测试计划</div>
              ) : suitesLoading ? (
                <Spinner size="sm" />
              ) : suites.length === 0 ? (
                <EmptyState icon="📋" title="暂无套件" />
              ) : (
                <ul className={styles.runList}>
                  {suites.map((suite) => (
                    <li
                      key={suite.id}
                      className={`${styles.runItem} ${selectedSuiteId === suite.id ? styles.runItemActive : ''}`}
                      onClick={() => setSelectedSuiteId(suite.id)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelectedSuiteId(suite.id); }}
                    >
                      <div className={styles.runName}>{suite.name}</div>
                      {suite.suiteType && (
                        <div className={styles.runStats}>
                          <span>{suite.suiteType}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            {/* Cases panel */}
            <main className={styles.resultsPanel}>
              <div className={styles.resultsPanelHeader}>
                <span>{selectedSuite ? `${selectedSuite.name} — 测试用例` : '测试用例'}</span>
              </div>
              {!selectedSuiteId ? (
                <EmptyState icon="✓" title="选择套件查看用例" description="先选择测试计划，再选择套件" />
              ) : casesLoading ? (
                <Spinner label="加载用例..." />
              ) : cases.length === 0 ? (
                <EmptyState icon="✓" title="暂无测试用例" />
              ) : (
                <table className={styles.resultsTable}>
                  <thead>
                    <tr>
                      <th>用例 ID</th>
                      <th>标题</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.id} className={styles.resultRow}>
                        <td className={styles.resultDuration}>#{c.id}</td>
                        <td className={styles.resultTitle}>{c.title ?? `用例 #${c.id}`}</td>
                        <td className={styles.resultSuite}>{c.state ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </main>
          </>
        ) : (
          <>
            {/* Runs panel */}
            <aside className={styles.runsPanel}>
              <div className={styles.panelHeader}>
                {selectedPlan ? `${selectedPlan.name} — 测试运行` : '测试运行'}
              </div>
              {!selectedPlanId ? (
                <div className={styles.placeholder}>← 请选择测试计划</div>
              ) : runsLoading ? (
                <Spinner size="sm" />
              ) : runs.length === 0 ? (
                <EmptyState icon="▶" title="暂无测试运行" />
              ) : (
                <ul className={styles.runList}>
                  {runs.map((run) => {
                    const passRate =
                      run.totalTests && run.totalTests > 0
                        ? Math.round(((run.passedTests ?? 0) / run.totalTests) * 100)
                        : null;
                    return (
                      <li
                        key={run.id}
                        className={`${styles.runItem} ${selectedRunId === run.id ? styles.runItemActive : ''}`}
                        onClick={() => setSelectedRunId(run.id)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') setSelectedRunId(run.id); }}
                      >
                        <div className={styles.runName}>{run.name}</div>
                        <div className={styles.runStats}>
                          {run.totalTests != null && <span>总计: {run.totalTests}</span>}
                          {run.passedTests != null && <span className={styles.passed}>通过: {run.passedTests}</span>}
                          {run.failedTests != null && run.failedTests > 0 && (
                            <span className={styles.failed}>失败: {run.failedTests}</span>
                          )}
                          {passRate != null && (
                            <span className={passRate >= 80 ? styles.passRateGood : styles.passRateBad}>
                              {passRate}%
                            </span>
                          )}
                        </div>
                        {run.startedDate && (
                          <div className={styles.runDate}>
                            {new Date(run.startedDate).toLocaleString('zh-CN')}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            {/* Results panel */}
            <main className={styles.resultsPanel}>
              <div className={styles.resultsPanelHeader}>
                <span>{selectedRun ? `${selectedRun.name} — 测试结果` : '测试结果'}</span>
                {selectedRunId && (
                  <select
                    className={styles.select}
                    value={outcomeFilter}
                    onChange={(e) => setOutcomeFilter(e.target.value)}
                  >
                    <option value="">全部结果</option>
                    <option value="Passed">通过</option>
                    <option value="Failed">失败</option>
                    <option value="Blocked">阻塞</option>
                    <option value="NotExecuted">未执行</option>
                  </select>
                )}
              </div>
              {!selectedRunId ? (
                <EmptyState icon="✓" title="选择测试运行查看结果" description="先选择测试计划，再选择测试运行" />
              ) : resultsLoading ? (
                <Spinner label="加载结果..." />
              ) : results.length === 0 ? (
                <EmptyState icon="✓" title="暂无测试结果" />
              ) : (
                <table className={styles.resultsTable}>
                  <thead>
                    <tr>
                      <th>测试名称</th>
                      <th>结果</th>
                      <th>耗时</th>
                      <th>执行人</th>
                      <th>测试套件</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id} className={styles.resultRow}>
                        <td className={styles.resultTitle}>{r.testCaseTitle ?? `测试 #${r.id}`}</td>
                        <td>{testOutcomeBadge(r.outcome)}</td>
                        <td className={styles.resultDuration}>
                          {r.durationInMs != null ? `${(r.durationInMs / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className={styles.resultRunner}>
                          {r.runBy?.displayName ?? r.assignedTo?.displayName ?? '—'}
                        </td>
                        <td className={styles.resultSuite}>{r.testSuite?.name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
