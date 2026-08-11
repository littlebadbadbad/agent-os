// Azure DevOps Test Plan, Test Run, and Test Result APIs

import { adoFetch } from './client';

// ── Test Plans (testplan API v6.1-preview.1) ─────────────────────────────────

export interface TestPlan {
  id: number;
  name: string;
  areaPath?: string;
  iteration?: string;
  state?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  owner?: { displayName?: string; uniqueName?: string };
  project?: { id: string; name: string };
}

export async function fetchTestPlans(
  collectionUrl: string,
  project: string,
  pat: string,
  filterActivePlans?: boolean,
): Promise<TestPlan[]> {
  const params = new URLSearchParams();
  if (filterActivePlans !== undefined) {
    params.set('filterActivePlans', String(filterActivePlans));
  }
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/testplan/plans${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: TestPlan[]; count?: number }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

// ── Test Runs (test API v6.1-preview.3) ───────────────────────────────────────

export interface TestRun {
  id: number;
  name: string;
  state: string;       // 'Unspecified' | 'NotStarted' | 'InProgress' | 'Completed' | 'Waiting' | 'Aborted' | 'NeedsInvestigation'
  startedDate?: string;
  completedDate?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  incompleteTests?: number;
  notApplicableTests?: number;
  unanalyzedTests?: number;
  owner?: { displayName?: string; uniqueName?: string };
  buildConfiguration?: { id?: number; buildDefinitionId?: number; flavor?: string };
  url?: string;
}

export async function fetchTestRuns(
  collectionUrl: string,
  project: string,
  pat: string,
  planId?: number,
  top?: number,
): Promise<TestRun[]> {
  const params = new URLSearchParams();
  if (planId !== undefined) params.set('planId', String(planId));
  if (top !== undefined) params.set('$top', String(top));
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/test/runs${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: TestRun[]; count?: number }>(url, pat, {
    apiVersion: '6.1-preview.3',
  });
  return res.value ?? [];
}

// ── Test Results (test API v6.1-preview.6) ────────────────────────────────────

export interface TestResult {
  id: number;
  testCaseTitle?: string;
  outcome: string;       // 'Passed' | 'Failed' | 'NotExecuted' | 'Blocked' | etc.
  state?: string;
  durationInMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  runBy?: { displayName?: string; uniqueName?: string };
  assignedTo?: { displayName?: string; uniqueName?: string };
  testCase?: { id?: string; name?: string };
  testSuite?: { id?: string; name?: string };
  startedDate?: string;
  completedDate?: string;
  url?: string;
}

export async function fetchTestResults(
  collectionUrl: string,
  project: string,
  pat: string,
  runId: number,
  top?: number,
  outcomes?: string[],  // e.g. ['Failed', 'Blocked']
): Promise<TestResult[]> {
  const params = new URLSearchParams();
  if (top !== undefined) params.set('$top', String(top));
  if (outcomes?.length) params.set('outcomes', outcomes.join(','));
  const qs = params.toString();
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/test/runs/${runId}/results${qs ? `?${qs}` : ''}`;
  const res = await adoFetch<{ value: TestResult[]; count?: number }>(url, pat, {
    apiVersion: '6.1-preview.6',
  });
  return res.value ?? [];
}

// ── Test Suites (testplan API v6.1-preview.1) ─────────────────────────────────

export interface TestSuite {
  id: number;
  name: string;
  /** 'StaticTestSuite' | 'DynamicTestSuite' | 'RequirementTestSuite' */
  suiteType?: string;
  state?: string;
  hasChildren?: boolean;
  plan?: { id: string; name?: string };
  parent?: { id: string; name?: string } | null;
  revision?: number;
  url?: string;
}

/**
 * Get all test suites within a test plan.
 * GET /{collection}/{project}/_apis/testplan/plans/{planId}/suites
 */
export async function fetchTestSuites(
  collectionUrl: string,
  project: string,
  pat: string,
  planId: number,
): Promise<TestSuite[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/testplan/plans/${planId}/suites`;
  const res = await adoFetch<{ value: TestSuite[]; count?: number }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

// ── Test Cases (testplan API v6.1-preview.3) ──────────────────────────────────

export interface TestCase {
  id: number;
  title?: string;
  state?: string;
  url?: string;
  pointAssignments?: Array<{
    configurationId?: number;
    configurationName?: string;
  }>;
}

/**
 * Get all test cases within a test suite.
 * Work item fields (System.Title, System.State) are unwrapped for convenience.
 * GET /{collection}/{project}/_apis/testplan/plans/{planId}/suites/{suiteId}/testcase
 */
export async function fetchTestCases(
  collectionUrl: string,
  project: string,
  pat: string,
  planId: number,
  suiteId: number,
): Promise<TestCase[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/_apis/testplan/plans/${planId}/suites/${suiteId}/testcase`;
  const res = await adoFetch<{
    value: Array<{
      testCase?: { id?: string; url?: string };
      workItem?: { id?: number; workItemFields?: Array<Record<string, unknown>> };
      pointAssignments?: Array<{ configurationId?: number; configurationName?: string }>;
    }>;
    count?: number;
  }>(url, pat, { apiVersion: '6.1-preview.3' });

  return (res.value ?? []).map((item) => {
    const fields = Object.assign(
      {},
      ...(item.workItem?.workItemFields ?? []),
    ) as Record<string, unknown>;
    return {
      id: item.workItem?.id ?? Number(item.testCase?.id ?? 0),
      title: fields['System.Title'] as string | undefined,
      state: fields['System.State'] as string | undefined,
      url: item.testCase?.url,
      pointAssignments: item.pointAssignments?.map((pa) => ({
        configurationId: pa.configurationId,
        configurationName: pa.configurationName,
      })),
    };
  });
}
